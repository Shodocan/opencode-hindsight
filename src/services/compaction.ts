import { hindsightClient } from "./client.js";
import { log } from "./logger.js";
import { CONFIG } from "../config.js";

const DEFAULT_THRESHOLD = 0.80;
const COMPACTION_COOLDOWN_MS = 30_000;

interface CompactionState {
  lastCompactionTime: Map<string, number>;
  compactionInProgress: Set<string>;
}

export interface CompactionOptions {
  threshold?: number;
  getModelLimit?: (providerID: string, modelID: string) => number | undefined;
}

export interface CompactionContext {
  directory: string;
  client: {
    session: {
      summarize: (params: { path: { id: string }; body: { providerID: string; modelID: string }; query: { directory: string } }) => Promise<unknown>;
      messages: (params: { path: { id: string }; query: { directory: string } }) => Promise<{ data?: Array<{ info: any }> }>;
      promptAsync: (params: { path: { id: string }; body: { agent?: string; parts: Array<{ type: string; text: string }> }; query: { directory: string } }) => Promise<unknown>;
    };
    tui: {
      showToast: (params: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<unknown>;
    };
  };
}

function createCompactionPrompt(projectMemories: string[]): string {
  const memoriesSection = projectMemories.length > 0 
    ? `
## Project Knowledge (from Hindsight)
The following project-specific knowledge should be preserved and referenced in the summary:
${projectMemories.map(m => `- ${m}`).join('\n')}
`
    : '';

  return `[COMPACTION CONTEXT INJECTION]

When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. MUST NOT Do (Critical Constraints)
- Things that were explicitly forbidden
- Approaches that failed and should not be retried
- User's explicit restrictions or preferences
- Anti-patterns identified during the session
${memoriesSection}
This context is critical for maintaining continuity after compaction.
`;
}

export function createCompactionHook(
  ctx: CompactionContext,
  banks: { user: string; project: string },
  options?: CompactionOptions
) {
  const state: CompactionState = {
    lastCompactionTime: new Map(),
    compactionInProgress: new Set(),
  };

  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  async function fetchProjectMemoriesForCompaction(): Promise<string[]> {
    try {
      const result = await hindsightClient.listMemories(banks.project, CONFIG.maxProjectMemories);
      const documents = result.documents || [];
      return documents.map((m: any) => m.content || m.summary || "").filter(Boolean);
    } catch (err) {
      log("[compaction] failed to fetch project memories", { error: String(err) });
      return [];
    }
  }

  async function handleSummary(sessionID: string): Promise<void> {
    try {
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      });

      const messages = (resp.data ?? resp) as Array<{ info: any; parts?: Array<{ type: string; text?: string }> }>;
      
      const summaryMessage = messages.find(m => 
        m.info.role === "assistant" && 
        m.info.summary === true
      );

      if (summaryMessage?.parts) {
        const textParts = summaryMessage.parts.filter(p => p.type === "text" && p.text);
        const summaryContent = textParts.map(p => p.text).join("\n");
        
        if (summaryContent && summaryContent.length > 100) {
          // Save summary as memory
          await hindsightClient.addMemory(
            `[Session Summary]\n${summaryContent}`,
            banks.project,
            { type: "conversation" }
          );
          log("[compaction] summary saved as memory", { sessionID });
        }
      }
    } catch (err) {
      log("[compaction] failed to capture summary", { error: String(err) });
    }
  }

  return {
    async event({ event }: { event: { type: string; properties?: unknown } }) {
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.lastCompactionTime.delete(sessionInfo.id);
          state.compactionInProgress.delete(sessionInfo.id);
        }
        return;
      }

      if (event.type === "message.updated") {
        const info = props?.info as any;
        if (!info) return;

        const sessionID = info.sessionID;
        if (!sessionID) return;

        // Check if this is a summary message
        if (info.role === "assistant" && info.summary === true && info.finish) {
          await handleSummary(sessionID);
          return;
        }

        // Check for compaction trigger
        if (info.role !== "assistant" || !info.finish) return;

        // Simplified compaction logic
        const lastCompaction = state.lastCompactionTime.get(sessionID) ?? 0;
        if (Date.now() - lastCompaction < COMPACTION_COOLDOWN_MS) return;

        const tokens = info.tokens;
        if (!tokens) return;

        const totalUsed = tokens.input + (tokens.cache?.read || 0) + tokens.output;
        const contextLimit = options?.getModelLimit?.(info.providerID || "", info.modelID || "") || 200_000;
        const usageRatio = totalUsed / contextLimit;

        if (usageRatio < threshold) return;

        state.compactionInProgress.add(sessionID);
        state.lastCompactionTime.set(sessionID, Date.now());

        try {
          // Show toast
          await ctx.client.tui.showToast({
            body: {
              title: "Preemptive Compaction",
              message: `Context at ${(usageRatio * 100).toFixed(0)}% - compacting with Hindsight context...`,
              variant: "warning",
              duration: 3000,
            },
          }).catch(() => {});

          // Fetch project memories and create prompt
          const projectMemories = await fetchProjectMemoriesForCompaction();
          const prompt = createCompactionPrompt(projectMemories);

          // Inject prompt as a message
          await ctx.client.session.promptAsync({
            path: { id: sessionID },
            body: {
              agent: info.agent,
              parts: [{ type: "text", text: prompt }],
            },
            query: { directory: ctx.directory },
          });

          // Trigger summarization
          await ctx.client.session.summarize({
            path: { id: sessionID },
            body: { providerID: info.providerID, modelID: info.modelID },
            query: { directory: ctx.directory },
          });

          await ctx.client.tui.showToast({
            body: {
              title: "Compaction Complete",
              message: "Session compacted with Hindsight context. Resuming...",
              variant: "success",
              duration: 2000,
            },
          }).catch(() => {});

        } catch (err) {
          log("[compaction] compaction failed", { sessionID, error: String(err) });
        } finally {
          state.compactionInProgress.delete(sessionID);
        }
      }
    },
  };
}