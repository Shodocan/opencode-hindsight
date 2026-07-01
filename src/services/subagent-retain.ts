import { createHash } from "node:crypto";
import { hindsightClient } from "./client.js";
import { log } from "./logger.js";
import type { ResolvedBanks } from "./tags.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubagentRetainOptions {
  enabled?: boolean;
  agents?: string[]; // empty = all agents
}

export interface SubagentRetainContext {
  directory: string;
  client: {
    session: {
      messages: (params: {
        path: { id: string };
        query: { directory: string };
      }) => Promise<{
        data?: Array<{ info: any; parts?: Array<{ type: string; text?: string }> }>;
      }>;
    };
  };
}

export type SubagentRetainBankResolver = (
  input?: { agent?: string | null; directory?: string | null },
) => ResolvedBanks;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface SubagentRetainState {
  retainedSessionIDs: Set<string>;
  retainedContentHashes: Map<string, Set<string>>; // bankID -> set of content hashes (per-bank dedup)
  cooldownTimestamps: Map<string, number>; // agent -> last retain time
}

const RETAIN_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function globToRegexSource(pattern: string): string {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") {
      out += ".*";
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return `^${out}$`;
}

function matchAgent(agent: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true; // empty = all agents
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      if (agent === pattern) return true;
    } else {
      const re = new RegExp(globToRegexSource(pattern));
      if (re.test(agent)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

export function createSubagentRetainHook(
  ctx: SubagentRetainContext,
  resolveBanksForRetain: SubagentRetainBankResolver,
  options?: SubagentRetainOptions,
) {
  const state: SubagentRetainState = {
    retainedSessionIDs: new Set(),
    retainedContentHashes: new Map(),
    cooldownTimestamps: new Map(),
  };

  const enabled = options?.enabled ?? true;
  const agents = options?.agents ?? [];

  return {
    async event({
      event,
    }: {
      event: { type: string; properties?: unknown };
    }) {
      try {
        // 1. Check enabled
        if (!enabled) return;

        // 2. Filter for session.deleted
        if (event.type !== "session.deleted") return;

        const props = event.properties as Record<string, unknown> | undefined;
        if (!props) return;

        const sessionInfo = props.info as Record<string, unknown> | undefined;
        if (!sessionInfo) return;

        // 3. Check parentID (subagent identification)
        if (!sessionInfo.parentID) return;

        const sessionID =
          typeof sessionInfo.id === "string" ? sessionInfo.id : undefined;
        if (!sessionID) return;

        // 4. Dedup by session ID
        if (state.retainedSessionIDs.has(sessionID)) return;

        // 5. Determine directory: prefer session.info.directory, fall back to ctx.directory
        const sessionDirectory =
          typeof sessionInfo.directory === "string" &&
          sessionInfo.directory.trim()
            ? sessionInfo.directory.trim()
            : ctx.directory;

        // 6. Fetch messages
        let messages: Array<{
          info: any;
          parts?: Array<{ type: string; text?: string }>;
        }>;
        try {
          const resp = await ctx.client.session.messages({
            path: { id: sessionID },
            query: { directory: sessionDirectory },
          });
          messages = (resp.data ?? resp) as typeof messages;
        } catch (err) {
          log("[subagent-retain] failed to fetch messages", {
            sessionID,
            error: String(err),
          });
          return; // graceful skip
        }

        if (!Array.isArray(messages) || messages.length === 0) return;

        // 7. Find last assistant message (skip compaction summaries)
        const assistantMessages = messages.filter(
          (m) =>
            m.info?.role === "assistant" && m.info?.summary !== true,
        );
        if (assistantMessages.length === 0) return;

        const lastMsg =
          assistantMessages[assistantMessages.length - 1]!;

        // 8. Extract agent from last assistant message (preserve PRIOR-002)
        const agent = firstString(
          lastMsg.info?.agent,
          lastMsg.info?.agentName,
          lastMsg.info?.mode,
        );
        if (!agent) return;

        // 9. Check agent allowlist
        if (!matchAgent(agent, agents)) return;

        // 10. Check cooldown
        const lastRetain = state.cooldownTimestamps.get(agent) ?? 0;
        if (Date.now() - lastRetain < RETAIN_COOLDOWN_MS) return;

        // 11. Extract text parts
        const textParts = (lastMsg.parts ?? [])
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!);
        if (textParts.length === 0) return;

        const content = textParts.join("\n");

        // 12. Resolve banks using session directory
        const banks = resolveBanksForRetain({
          agent,
          directory: sessionDirectory,
        });

        // 13. Content hash dedup — scoped per-bank
        const contentHash = sha256(content);
        const bankHashes =
          state.retainedContentHashes.get(banks.project) ?? new Set<string>();
        if (bankHashes.has(contentHash)) return;

        // 14. Retain — fire-and-forget to avoid blocking host
        hindsightClient
          .addMemory(content, banks.project, { type: "conversation" })
          .then((result) => {
            if (result.success) {
              state.retainedSessionIDs.add(sessionID);
              bankHashes.add(contentHash);
              state.retainedContentHashes.set(banks.project, bankHashes);
              state.cooldownTimestamps.set(agent, Date.now());

              log("[subagent-retain] retained", {
                sessionID,
                agent,
                projectBankSource: banks.projectSource,
                agentPattern: banks.agentPattern,
                contentLength: content.length,
                contentHash: contentHash.slice(0, 8),
              });
            } else {
              log("[subagent-retain] addMemory failed", {
                sessionID,
                agent,
                error: result.error || "unknown",
              });
            }
          })
          .catch((err) => {
            log("[subagent-retain] addMemory error", {
              sessionID,
              agent,
              error: String(err),
            });
            // Do NOT add to retainedSessionIDs — allow retry on next event
          });
      } catch (err) {
        log("[subagent-retain] unexpected error", {
          error: String(err),
        });
        // Never throw
      }
    },
  };
}
