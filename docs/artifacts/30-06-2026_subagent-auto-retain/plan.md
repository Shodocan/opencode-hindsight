# Implementation Plan: Subagent Auto-Retain

## Spec Reference

- **Spec path**: `docs/artifacts/30-06-2026_subagent-auto-retain/spec.md`
- **Spec status**: `approved`
- **User choices**: `docs/artifacts/30-06-2026_subagent-auto-retain/user-choices.md`
- **Research**: `docs/artifacts/30-06-2026_subagent-auto-retain/research.md`
- **Branch**: `feat/subagent-auto-retain` (worktree at `../opencode-hindsight-subagent-retain`, rooted at `origin/main`)

## User Decisions (from brainstorm)

| ID | Decision | Value |
|---|---|---|
| DEC-001 | Capture trigger | `session.deleted` with `parentID` check |
| DEC-002 | Content shape | Last assistant message (text parts only) |
| DEC-003 | Memory type | `conversation` |
| DEC-004 | Config: enable | `autoRetain.enabled` (bool, default `true`) |
| DEC-005 | Config: allowlist | `autoRetain.agents` (string[], empty = all agents) |
| DEC-006 | Dedup strategy | Session ID + content hash (SHA-256 prefix) |
| DEC-007 | Subagent identification | `Session.parentID` present on `session.deleted` |
| DEC-008 | Messages fetch | `ctx.client.session.messages()` at deletion time; graceful skip on failure |
| DEC-009 | Review mode | Adversarial plan review (autonomous after spec approval) |
| DEC-010 | Workspace | Worktree at `../opencode-hindsight-subagent-retain` on `feat/subagent-auto-retain` |
| PRIOR-001 | Bank routing | `resolveBanks({ directory, agent })` |
| PRIOR-002 | Agent extraction | `firstString(info.agent, info.mode)` — **note: `agentName` does not exist in SDK types** |
| PRIOR-003 | Error isolation | try/catch, never throw, never block host |
| PRIOR-004 | Raw content/previews | Must NOT be logged |
| PRIOR-005 | TDD | Failing test first, verify red, then implement |

## Architecture

### New File: `src/services/subagent-retain.ts`

A new module exporting `createSubagentRetainHook()`, analogous to `createCompactionHook()` in `compaction.ts`. Handles `session.deleted` events where `props.info.parentID` is present (indicating a subagent session), fetches the session's last assistant message, and retains it to the correct project bank.

### Hook Wiring: `src/index.ts`

The existing `event` handler (line 505-509) currently delegates only to `compactionHook.event(input)`. Add a second hook chain for the subagent retain hook. Both hooks run on every event; each filters for its own event types.

### Config: `src/config.ts`

Add `autoRetain.enabled` (boolean, default `true`) and `autoRetain.agents` (string array, empty = all agents) under the `HindsightConfig` interface.

## Touch Set

| File | Change | Task |
|---|---|---|
| `src/config.ts` | Add `autoRetain` config fields + sanitization | T001 |
| `test/config.test.ts` | Add tests for `autoRetain` config defaults and sanitization | T001 |
| `src/services/subagent-retain.ts` | **NEW** — subagent retain hook | T002b |
| `test/services/subagent-retain.test.ts` | **NEW** — unit tests for subagent retain logic | T002a |
| `src/index.ts` | Wire subagent retain hook alongside compaction hook | T003 |
| `test/index.test.ts` | Add wiring test for subagent retain hook | T003 |

## Acceptance Criteria Traceability

| AC | Description | Task(s) | Validation |
|---|---|---|---|
| AC-001 | `autoRetain.enabled` defaults to `true` when absent | T001 | `bun test test/config.test.ts` — assert `CONFIG.autoRetain.enabled === true` |
| AC-002 | `autoRetain.agents` defaults to `[]` (all agents) | T001 | `bun test test/config.test.ts` — assert `CONFIG.autoRetain.agents === []` |
| AC-003 | `autoRetain.agents` sanitizes entries (trims, drops empty) | T001 | `bun test test/config.test.ts` — assert sanitized array |
| AC-004 | Non-subagent `session.deleted` (no `parentID`) is ignored | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — no `addMemory` call |
| AC-005 | Subagent `session.deleted` retains last assistant message | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — `addMemory` called with correct content |
| AC-006 | Session ID dedup prevents double-retain | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — same event twice = one call |
| AC-007 | Content hash dedup prevents duplicate content (per-bank, F-033) | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — same content, different sessions, same bank = one call; different banks = two calls |
| AC-008 | Agent allowlist filters by exact/glob match | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — `agents: ["review-*"]` matches `review-security`, skips `builder` |
| AC-009 | Empty agents allowlist = all agents | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — `agents: []` retains any agent |
| AC-010 | `enabled: false` skips all retains | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — no `addMemory` call |
| AC-011 | Messages API failure is graceful (no crash) | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — mock throws, no `addMemory` call |
| AC-012 | Per-agent cooldown (30s) prevents rapid retains | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — two events same agent within 30s = one call |
| AC-013 | No assistant message in session = skip | T002a/T002b | `bun test test/services/subagent-retain.test.ts` — only user messages, no `addMemory` call |
| AC-014 | Plugin wires both hooks and calls both on events | T003 | `bun test test/index.test.ts` — verify both hooks created and invoked |
| AC-015 | No raw content/previews in log output | T002a/T002b, T003 | `bun test` — log assertions check no sentinel content in log calls |
| AC-016 | `session.deleted.info.directory` used for messages fetch and bank resolution when available | T002a/T002b | Test verifies directory from session info is passed to `messages()` and `resolveBanks()` |

## Task Decomposition

### T001: Config fields + sanitization in `src/config.ts` + tests

**Task type**: `config`

**Files touched**:
- `src/config.ts` (modify)
- `test/config.test.ts` (modify)

**Dependencies**: None

**Acceptance criteria**: AC-001, AC-002, AC-003

**Implementation**:

1. **Add to `HindsightConfig` interface** in `src/config.ts` (after line 28):
   ```typescript
   autoRetain?: {
     enabled?: boolean;
     agents?: string[];
   };
   ```

2. **Add sanitizer functions** in `src/config.ts` (after `validateCompactionThreshold`):
   ```typescript
   function validateAutoRetainEnabled(value: unknown): boolean {
     return typeof value === 'boolean' ? value : true;
   }

   function sanitizeAutoRetainAgents(value: unknown): string[] {
     if (!Array.isArray(value)) return [];
     return value
       .map(s => typeof s === 'string' ? s.trim() : '')
       .filter(s => s.length > 0);
   }
   ```

3. **Add `"autoRetain"` to the `DEFAULTS` `Omit` list** in `src/config.ts` (line 57). Without this, `Required<Omit<HindsightConfig, ...>>` would demand `autoRetain` be present in the DEFAULTS object, causing a TypeScript compile error:
   ```typescript
   const DEFAULTS: Required<Omit<HindsightConfig, "userBank" | "projectBank" | "baseUrl" | "apiKey" | "agentProjectBanks" | "runtimeProjectBanks" | "autoRetain">> = {
   ```

4. **Add to `CONFIG` export** in `src/config.ts` (after `runtimeProjectBanks` line):
   ```typescript
   autoRetain: {
     enabled: validateAutoRetainEnabled(fileConfig.autoRetain?.enabled),
     agents: sanitizeAutoRetainAgents(fileConfig.autoRetain?.agents),
   },
   ```

5. **Add tests** in `test/config.test.ts`:
   - `autoRetain.enabled` defaults to `true` when absent
   - `autoRetain.agents` defaults to `[]` when absent
   - `autoRetain.agents` sanitizes entries (trims whitespace, drops empty strings)
   - `autoRetain.enabled` with non-boolean value defaults to `true`
   - `autoRetain.agents` with non-array value defaults to `[]`

**Validation commands**:
```bash
bun test test/config.test.ts
bun run typecheck
```

---

### T002a: Write failing tests for `src/services/subagent-retain.ts` (RED phase)

**Task type**: `test` (TDD red phase — PRIOR-005 / F-C-002)

**Files touched**:
- `test/services/subagent-retain.test.ts` (NEW — tests only, no implementation yet)

**Dependencies**: T001 (config fields must exist for test imports)

**Acceptance criteria**: All tests in `test/services/subagent-retain.test.ts` fail (RED) before implementation.

**Validation command**:
```bash
bun test test/services/subagent-retain.test.ts  # expect: all tests FAIL (red)
```

**Implementation**: Write the full test file (all 10 test cases from the spec) in `test/services/subagent-retain.test.ts`. Do NOT create `src/services/subagent-retain.ts` yet — the import will fail, which is the expected RED state. Verify all tests fail before proceeding to T002b.

The test file content is the same as the test section below in T002b — write it in T002a, verify red, then implement in T002b.

---

### T002b: Implement `src/services/subagent-retain.ts` (GREEN phase)

**Task type**: `feature` (TDD green phase — PRIOR-005 / F-C-002)

**Files touched**:
- `src/services/subagent-retain.ts` (NEW — implementation)
- `test/services/subagent-retain.test.ts` (already written in T002a — should now pass)

**Dependencies**: T002a (failing tests must exist and be verified red first)

**Acceptance criteria**: AC-004 through AC-013, AC-015, AC-016. All tests in `test/services/subagent-retain.test.ts` pass (GREEN).

**Validation command**:
```bash
bun test test/services/subagent-retain.test.ts  # expect: all tests PASS (green)
```

**Implementation details**:

#### `src/services/subagent-retain.ts`

**Interfaces**:
```typescript
export interface SubagentRetainOptions {
  enabled?: boolean;
  agents?: string[];  // empty = all agents
}

export interface SubagentRetainContext {
  directory: string;
  client: {
    session: {
      messages: (params: { path: { id: string }; query: { directory: string } }) => Promise<{ data?: Array<{ info: any; parts?: Array<{ type: string; text?: string }> }> }>;
    };
  };
}

export type SubagentRetainBankResolver = (input?: { agent?: string | null; directory?: string | null }) => ResolvedBanks;
```

**State**:
```typescript
interface SubagentRetainState {
  retainedSessionIDs: Set<string>;
  retainedContentHashes: Map<string, Set<string>>;  // bankID -> set of content hashes (per-bank dedup, F-033)
  cooldownTimestamps: Map<string, number>;       // agent -> last retain time
}
```

**Constants**:
```typescript
const RETAIN_COOLDOWN_MS = 30_000;
```

**Helper: `firstString`** (copied locally to avoid import dependency on `index.ts`):
```typescript
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
```

**Helper: `sha256`** (copied locally):
```typescript
import { createHash } from "node:crypto";
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
```

**Agent pattern matching** — reuse `globToRegexSource` from `tags.ts`. Since it is not exported, copy the function locally:
```typescript
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
```

**`createSubagentRetainHook`**:
```typescript
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
    async event({ event }: { event: { type: string; properties?: unknown } }) {
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

        const sessionID = typeof sessionInfo.id === "string" ? sessionInfo.id : undefined;
        if (!sessionID) return;

        // 4. Dedup by session ID
        if (state.retainedSessionIDs.has(sessionID)) return;

        // 5. Determine directory: prefer session.info.directory, fall back to ctx.directory
        const sessionDirectory = typeof sessionInfo.directory === "string" && sessionInfo.directory.trim()
          ? sessionInfo.directory.trim()
          : ctx.directory;

        // 6. Fetch messages
        let messages: Array<{ info: any; parts?: Array<{ type: string; text?: string }> }>;
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

        // 7. Find last assistant message (skip compaction summaries — F-FINAL-GPT55-003 / F-002)
        const assistantMessages = messages.filter(
          m => m.info?.role === "assistant" && m.info?.summary !== true,
        );
        if (assistantMessages.length === 0) return;

        const lastMsg = assistantMessages[assistantMessages.length - 1]!;

        // 8. Extract agent from last assistant message (preserve PRIOR-002: agent, agentName, mode)
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
          .filter(p => p.type === "text" && p.text)
          .map(p => p.text!);
        if (textParts.length === 0) return;

        const content = textParts.join("\n");

        // 13. Resolve banks using session directory (F-FINAL-GPT55-002 / F-C-001: pass sessionDirectory for correct generated fallback)
        const banks = resolveBanksForRetain({ agent, directory: sessionDirectory });

        // 14. Content hash dedup — scoped per-bank (F-033: cross-bank dedup causes content loss)
        const contentHash = sha256(content);
        const bankHashes = state.retainedContentHashes.get(banks.project) ?? new Set<string>();
        if (bankHashes.has(contentHash)) return;

        // 15. Retain — fire-and-forget to avoid blocking host (F-FINAL-GPT55-001: PRIOR-003 "never block host")
        hindsightClient.addMemory(
          content,
          banks.project,
          { type: "conversation" },
        ).then((result) => {
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
        }).catch((err) => {
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
```

**Imports needed**:
```typescript
import { createHash } from "node:crypto";
import { hindsightClient } from "./client.js";
import { log } from "./logger.js";
import type { ResolvedBanks } from "./tags.js";
```

#### `test/services/subagent-retain.test.ts`

**Test structure** (TDD: write failing tests first, verify red, then implement):

```typescript
import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock hindsightClient
const addMemoryCalls: Array<{ content: string; bank: string; metadata: unknown }> = [];
const logCalls: Array<{ message: string; data: unknown }> = [];

mock.module("../../src/services/client.js", () => ({
  hindsightClient: {
    addMemory: async (content: string, bank: string, metadata: unknown) => {
      addMemoryCalls.push({ content, bank, metadata });
      return { success: true };
    },
  },
}));

mock.module("../../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data });
  },
}));

const { createSubagentRetainHook } = await import("../../src/services/subagent-retain");

function makeContext(directory = "/tmp/test") {
  return {
    directory,
    client: {
      session: {
        messages: async () => ({ data: [] }),
      },
    },
  };
}

function banksForAgent(agent?: string | null) {
  return {
    user: "user-bank",
    project: `${agent ?? "default"}-project-bank`,
    projectSource: agent ? "agentProjectBanks" as const : "generated" as const,
    agent: agent ?? undefined,
    agentPattern: agent ?? undefined,
  };
}

beforeEach(() => {
  addMemoryCalls.length = 0;
  logCalls.length = 0;
});
```

**Test cases** (10 tests):

1. **ignores non-subagent session.deleted** — event with no `parentID` → no `addMemory` call
2. **retains subagent last message** — event with `parentID`, mock messages with one assistant message → `addMemory` called with correct content and bank
3. **dedup by session ID** — same event twice → one `addMemory` call
4. **dedup by content hash** — two different sessions with identical content → one `addMemory` call
5. **respects agent allowlist** — `agents: ["review-*"]`, session for `review-security` retains, session for `builder` skips
6. **empty agents = all agents** — `agents: []`, any agent retains
7. **disabled config skips** — `enabled: false` → no `addMemory` call
8. **messages API failure is graceful** — mock `messages()` throws → no crash, no `addMemory` call
9. **cooldown prevents rapid retains** — two events same agent within 30s → one `addMemory` call
10. **no assistant message skips** — only user messages in session → no `addMemory` call

**Validation commands**:
```bash
bun test test/services/subagent-retain.test.ts
bun run typecheck
```

---

### T003: Wire hook in `src/index.ts` + test

**Task type**: `integration`

**Files touched**:
- `src/index.ts` (modify)
- `test/index.test.ts` (modify)

**Dependencies**: T002b (hook module must exist)

**Acceptance criteria**: AC-014, AC-015

**Implementation**:

1. **Add import** in `src/index.ts` (after compaction import, line 9):
   ```typescript
   import { createSubagentRetainHook, type SubagentRetainContext } from "./services/subagent-retain.js";
   ```

2. **Create hook** in `src/index.ts` (after compactionHook creation, around line 159):
   ```typescript
    const subagentRetainHook = isConfigured() && ctx.client
      ? createSubagentRetainHook(
          ctx as SubagentRetainContext,
          ({ agent, directory: sessionDirectory } = {}) => resolveBanks({ directory: sessionDirectory ?? directory, agent: agent ?? undefined }),
          {
            enabled: CONFIG.autoRetain.enabled,
            agents: CONFIG.autoRetain.agents,
          }
        )
      : null;
   ```

3. **Wire in event handler** (modify lines 505-509):
   ```typescript
   event: async (input: { event: { type: string; properties?: unknown } }) => {
     if (compactionHook) {
       await compactionHook.event(input);
     }
     if (subagentRetainHook) {
       await subagentRetainHook.event(input);
     }
   },
   ```

4. **Add test** in `test/index.test.ts`:
   - Import `createSubagentRetainHook` (add to existing import on line 45)
   - Test: "Plugin wires subagentRetainHook and compactionHook" — verify both hooks are created and called on events
   - Test: "No raw content in logs from subagent retain" — verify sentinel content does not appear in log calls

**Validation commands**:
```bash
bun test test/index.test.ts
bun run typecheck
```

---

### T990: Full validation

**Task type**: `validation`

**Dependencies**: T001, T002b, T003

**Validation commands**:
```bash
bun test
bun run typecheck
bun run build
```

**Acceptance criteria**: All tests pass, typecheck passes, build succeeds.

---

### T999: Commit

**Task type**: `commit`

**Dependencies**: T990

**Steps**:
1. `rtk git status --short` — verify only intended files changed
2. `rtk git diff --check` — verify no whitespace errors
3. `rtk git add src/config.ts src/services/subagent-retain.ts src/index.ts test/config.test.ts test/services/subagent-retain.test.ts test/index.test.ts`
4. `rtk git commit -m "feat: auto-retain subagent last message on session.deleted"`

## Implementation Order

```
T001 (config) ──> T002 (hook + tests) ──> T003 (wiring) ──> T990 (validate) ──> T999 (commit)
```

T001 and T002 can be partially parallelized (config tests can be written while the hook module is being designed), but T002 depends on T001's config types being available. T003 depends on T002's hook module existing.

## Validation Matrix

| Check | Command | Expected |
|---|---|---|
| Config tests | `bun test test/config.test.ts` | All pass |
| Subagent retain tests | `bun test test/services/subagent-retain.test.ts` | All pass |
| Index wiring tests | `bun test test/index.test.ts` | All pass |
| Full test suite | `bun test` | All pass (34+ existing + ~15 new) |
| TypeScript check | `bun run typecheck` | No errors |
| Build | `bun run build` | Succeeds |
| Git status | `rtk git status --short` | Only 6 intended files |
| Git diff | `rtk git diff --check` | No whitespace errors |

## Spec Immutability

**Status**: `none` — no spec changes required. All implementation details match the approved spec.

## Research Evidence Summary

| Source | Evidence |
|---|---|
| Code researcher | Confirmed config pattern, compaction hook pattern, index.ts wiring, tags.ts patterns, test patterns, client.ts addMemory signature |
| Doc researcher | Confirmed `EventSessionDeleted` type, `Session.parentID` field, `messages()` SDK method signature, `Message.agent`/`Message.mode` fields. **Noted: `agentName` does not exist in SDK types** — however, the existing compaction hook uses all three fields (`info.agent, info.agentName, info.mode`) and runs successfully. User chose to keep all three (preserving PRIOR-002); `firstString` safely skips undefined values. |
| Advisor | Confirmed touch set (6 files), recommended using `session.deleted.info.directory` for messages/bank resolution, noted `globToRegexSource` is internal (copy locally), recommended additional test cases |

## Unvalidated Items

- `agentName` field: SDK types do not define `agentName`, but the compaction hook uses `firstString(info.agent, info.agentName, info.mode)` in production. User decision (F-CODE-001): keep all three — `firstString` safely skips undefined values. Plan preserves PRIOR-002 unchanged.
- `globToRegexSource` is not exported from `tags.ts` — the plan copies the function locally in `subagent-retain.ts` rather than modifying `tags.ts`.
