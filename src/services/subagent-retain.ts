import { createHash } from "node:crypto";
import { hindsightClient } from "./client.js";
import { log } from "./logger.js";
import { stripPrivateContent, isFullyPrivate } from "./privacy.js"; // C-009
import type { ResolvedBanks } from "./tags.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubagentRetainOptions {
  enabled?: boolean;
  /**
   * Agent name patterns to auto-retain. Supports exact names and `*` glob
   * patterns. Empty array = all agents.
   *
   * **Fail-closed**: If the configured value is not a string array (e.g. a
   * number, object, or boolean), auto-retain is disabled entirely
   * (`enabled: false`). This prevents misconfiguration from silently
   * retaining all agents. See `sanitizeAutoRetainAgents` in config.ts.
   * (C-016)
   */
  agents?: string[];
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
const MAX_RETAIN_CONTENT_LENGTH = 100_000; // C-010

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

        // 4. Dedup by session ID (synchronous — prevents in-flight race)
        // C-002: Reserve session ID synchronously BEFORE any async work
        if (state.retainedSessionIDs.has(sessionID)) return;
        state.retainedSessionIDs.add(sessionID);

        // 5. Determine directory: prefer session.info.directory, fall back to ctx.directory
        const sessionDirectory =
          typeof sessionInfo.directory === "string" &&
          sessionInfo.directory.trim()
            ? sessionInfo.directory.trim()
            : ctx.directory;

        // C-019: Fire-and-forget the messages-fetch + retain workflow so the
        // session.deleted event handler returns promptly without blocking host.
        // C-004: Add .catch() to prevent unhandled rejection.
        (async () => {
          // Declare rollback-tracked variables at IIFE scope so the catch
          // block can reach them for comprehensive rollback (C-001).
          let contentHash: string | undefined;
          let bankHashes: Set<string> | undefined;
          let agent: string | undefined;
          let setAt: number | undefined;
          let reservedContent = false;

          try {
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
              state.retainedSessionIDs.delete(sessionID); // roll back session ID
              return; // graceful skip
            }

            if (!Array.isArray(messages) || messages.length === 0) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            // 7. Find last assistant message (skip compaction summaries)
            const assistantMessages = messages.filter(
              (m) =>
                m.info?.role === "assistant" && m.info?.summary !== true,
            );
            if (assistantMessages.length === 0) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            const lastMsg =
              assistantMessages[assistantMessages.length - 1]!;

            // 8. Extract agent from last assistant message (preserve PRIOR-002)
            agent = firstString(
              lastMsg.info?.agent,
              lastMsg.info?.agentName,
              lastMsg.info?.mode,
            );
            if (!agent) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            // 9. Check agent allowlist
            if (!matchAgent(agent, agents)) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            // 10. Check cooldown
            const lastRetain = state.cooldownTimestamps.get(agent) ?? 0;
            if (Date.now() - lastRetain < RETAIN_COOLDOWN_MS) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            // 11. Extract text parts
            const textParts = (lastMsg.parts ?? [])
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text!);
            if (textParts.length === 0) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            const rawContent = textParts.join("\n");

            // C-009: Privacy filtering — strip private content before storage
            const content = stripPrivateContent(rawContent);
            if (isFullyPrivate(rawContent)) {
              log("[subagent-retain] skipped — fully private content", {
                sessionID,
                agent,
              });
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            // C-010: Content size guard — skip oversized content
            if (content.length > MAX_RETAIN_CONTENT_LENGTH) {
              log("[subagent-retain] skipped — content too large", {
                sessionID,
                agent,
                contentLength: content.length,
              });
              state.retainedSessionIDs.delete(sessionID);
              return;
            }

            // 12. Resolve banks using session directory
            const banks = resolveBanksForRetain({
              agent,
              directory: sessionDirectory,
            });

            // 13. Content hash dedup — scoped per-bank
            // C-005: Reserve content hash synchronously before addMemory
            contentHash = sha256(content);
            // C-003: Atomic get-or-create — immediately set so concurrent
            // IIFEs share the same Set instance
            bankHashes =
              state.retainedContentHashes.get(banks.project) ?? new Set<string>();
            state.retainedContentHashes.set(banks.project, bankHashes);
            if (bankHashes.has(contentHash)) {
              state.retainedSessionIDs.delete(sessionID);
              return;
            }
            bankHashes.add(contentHash);
            reservedContent = true;

            // C-012: Store cooldown timestamp for compare-and-delete on rollback
            setAt = Date.now();
            state.cooldownTimestamps.set(agent, setAt);

            // 14. Retain — fire-and-forget to avoid blocking host
            hindsightClient
              .addMemory(content, banks.project, { type: "conversation" })
              .then((result) => {
                if (result.success) {
                  log("[subagent-retain] retained", {
                    sessionID,
                    agent,
                    projectBankSource: banks.projectSource,
                    agentPattern: banks.agentPattern,
                    contentLength: content.length,
                    contentHash: contentHash!.slice(0, 8),
                  });
                } else {
                  // Roll back dedup state on failure to allow retry
                  state.retainedSessionIDs.delete(sessionID);
                  bankHashes!.delete(contentHash!);
                  // C-012: Compare-and-delete cooldown
                  if (state.cooldownTimestamps.get(agent!) === setAt) {
                    state.cooldownTimestamps.delete(agent!);
                  }
                  log("[subagent-retain] addMemory failed", {
                    sessionID,
                    agent,
                    error: result.error || "unknown",
                  });
                }
              })
              .catch((err) => {
                // Roll back dedup state on error to allow retry
                state.retainedSessionIDs.delete(sessionID);
                bankHashes!.delete(contentHash!);
                // C-012: Compare-and-delete cooldown
                if (state.cooldownTimestamps.get(agent!) === setAt) {
                  state.cooldownTimestamps.delete(agent!);
                }
                log("[subagent-retain] addMemory error", {
                  sessionID,
                  agent,
                  error: String(err),
                });
              });
          } catch (err) {
            // C-001: Comprehensive rollback — roll back everything that was
            // reserved, not just sessionID
            state.retainedSessionIDs.delete(sessionID);
            if (reservedContent && bankHashes && contentHash) {
              bankHashes.delete(contentHash);
            }
            if (agent && setAt !== undefined && state.cooldownTimestamps.get(agent) === setAt) {
              state.cooldownTimestamps.delete(agent);
            }
            log("[subagent-retain] unexpected error in async workflow", {
              sessionID,
              error: String(err),
            });
          }
        })().catch((err) => {
          // C-004: Catch unhandled IIFE rejection
          log("[subagent-retain] unhandled IIFE rejection", {
            error: String(err),
          });
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
