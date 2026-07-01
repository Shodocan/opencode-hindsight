# Spec: Subagent Auto-Retain

## Summary

Automatically capture subagent work into the subagent's mapped Hindsight project bank when a subagent session ends without compaction. Subagents are typically short-lived and never cross the 80% context threshold, so their work is silently lost unless the model explicitly calls `hindsight add`. This feature auto-retains the subagent's final result message to the correct agent-routed bank.

## User Choices

All decisions recorded in `docs/artifacts/30-06-2026_subagent-auto-retain/user-choices.md`.

## Architecture

### New File: `src/services/subagent-retain.ts`

A new module exporting `createSubagentRetainHook()`, analogous to `createCompactionHook()` in `compaction.ts`. It handles `session.deleted` events where `props.info.parentID` is present (indicating a subagent session), fetches the session's last assistant message, and retains it to the correct project bank.

### Hook Wiring: `src/index.ts`

The existing `event` handler (line 505-509) currently delegates only to `compactionHook.event(input)`. Add a second hook chain for the subagent retain hook. Both hooks run on every event; each filters for its own event types.

### Config: `src/config.ts`

Add two new config knobs under the `HindsightConfig` interface:

```typescript
interface HindsightConfig {
  // ... existing fields ...
  autoRetain?: {
    enabled?: boolean;
    agents?: string[];
  };
}
```

Defaults:
- `enabled`: `true` (auto-retain is on by default when the plugin is configured)
- `agents`: `[]` (empty = all agents are auto-retained)

Sanitization:
- `enabled`: boolean, default `true` if absent or non-boolean
- `agents`: string array, each trimmed, empty strings dropped. Empty array = all agents.
- **Fail-closed**: If `agents` is not an array (e.g. number, object, boolean), `sanitizeAutoRetainAgents` returns `{ agents: [], valid: false }`, and the CONFIG builder sets `enabled: false`. This prevents misconfiguration from silently retaining all agents. (C-026)

### Touch Set

| File | Change |
|---|---|
| `src/services/subagent-retain.ts` | **NEW** — subagent retain hook |
| `src/index.ts` | Wire subagent retain hook alongside compaction hook |
| `src/config.ts` | Add `autoRetain.enabled` and `autoRetain.agents` config |
| `test/index.test.ts` | Add tests for subagent retain hook wiring |
| `test/services/subagent-retain.test.ts` | **NEW** — unit tests for subagent retain logic |

## Detailed Design

### 1. `createSubagentRetainHook(ctx, resolveBanksForRetain, options)`

**Signature:**
```typescript
export function createSubagentRetainHook(
  ctx: SubagentRetainContext,
  resolveBanksForRetain: (input?: { agent?: string | null }) => ResolvedBanks,
  options?: SubagentRetainOptions,
): { event: (input: { event: { type: string; properties?: unknown } }) => Promise<void> };
```

**Interfaces:**
```typescript
interface SubagentRetainOptions {
  enabled?: boolean;
  agents?: string[];  // empty = all agents
}

interface SubagentRetainState {
  retainedSessionIDs: Set<string>;       // dedup by session ID
  retainedContentHashes: Map<string, string>;  // sessionID -> content hash
  cooldownTimestamps: Map<string, number>;     // agent -> last retain time
}

const RETAIN_COOLDOWN_MS = 30_000;  // same as compaction cooldown
```

**Event handler logic (fire-and-forget IIFE pattern):**

```
event({ type: "session.deleted", properties }) →
   1. If !options.enabled → return
   2. Extract props = properties as Record
   3. Extract sessionInfo = props.info as Session
   4. If !sessionInfo?.parentID → return (not a subagent session)
   5. Reserve sessionID in retainedSessionIDs synchronously (C-002 TOCTOU fix)
   6. Extract directory from sessionInfo.directory or ctx.directory
   7. Fire-and-forget IIFE (never await in event handler — C-019):
      a. Try: fetch messages via ctx.client.session.messages(...)
      b. If messages fetch fails → log warning, roll back sessionID, return
      c. Find last assistant message (role === "assistant", summary !== true)
      d. If no assistant message → roll back sessionID, return
      e. Extract agent = firstString(info.agent, info.agentName, info.mode)
      f. If no agent → roll back sessionID, return
      g. If options.agents is non-empty and agent doesn't match → roll back sessionID, return
      h. Check cooldown: if agent has recent retain within RETAIN_COOLDOWN_MS → roll back sessionID, return
      i. Extract text parts, join by "\n"
      j. C-009: Call stripPrivateContent(rawContent); if isFullyPrivate → skip with log, roll back sessionID
      k. C-010: If content.length > MAX_RETAIN_CONTENT_LENGTH → skip with log, roll back sessionID
      l. Resolve banks: resolveBanksForRetain({ agent, directory })
      m. C-003: Atomic get-or-create bankHashes Set, immediately .set() so concurrent IIFEs share the same instance
      n. C-005: Reserve contentHash in bankHashes synchronously before addMemory
      o. C-012: Store cooldown timestamp, save setAt for compare-and-delete
      p. Call hindsightClient.addMemory(content, banks.project, { type: "conversation" })
      q. On success: log metadata (no raw content)
      r. On failure: roll back sessionID, contentHash, cooldown (compare-and-delete)
      s. Outer catch: comprehensive rollback of sessionID, contentHash, cooldown (C-001)
   8. IIFE .catch() prevents unhandled rejection (C-004)
   9. All operations wrapped in try/catch, never throw
```

### 2. Agent Pattern Matching

Reuse the same glob matching logic from `tags.ts` (`globToRegexSource` and `matchAgentBank` patterns). The `agents` allowlist supports:
- Exact agent names: `"review-security"` matches only that agent.
- Glob patterns: `"review-*"` matches all review agents.
- Empty array: matches all agents (no filtering).

### 3. Hook Wiring in `src/index.ts`

```typescript
// In HindsightPlugin:
const subagentRetainHook = isConfigured() && ctx.client
  ? createSubagentRetainHook(
      ctx as SubagentRetainContext,
      ({ agent } = {}) => resolveBanks({ directory, agent: agent ?? undefined }),
      {
        enabled: CONFIG.autoRetain.enabled,
        agents: CONFIG.autoRetain.agents,
      }
    )
  : null;

// In event handler:
event: async (input) => {
  if (compactionHook) await compactionHook.event(input);
  if (subagentRetainHook) await subagentRetainHook.event(input);
}
```

### 4. Config Changes

In `src/config.ts`:

```typescript
interface HindsightConfig {
  // ... existing fields ...
  autoRetain?: {
    enabled?: boolean;
    agents?: string[];
  };
}

// Sanitization:
function validateAutoRetainEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

function sanitizeAutoRetainAgents(value: unknown): { agents: string[]; valid: boolean } {
  if (value === undefined || value === null) return { agents: [], valid: true }; // absent = all agents
  if (!Array.isArray(value)) return { agents: [], valid: false }; // non-array = fail closed
  const agents = value
    .map(s => typeof s === 'string' ? s.trim() : '')
    .filter(s => s.length > 0);
  return { agents, valid: true };
}

// In CONFIG:
autoRetain: (() => {
  const agentsResult = sanitizeAutoRetainAgents(fileConfig.autoRetain?.agents);
  const enabled = agentsResult.valid ? validateAutoRetainEnabled(fileConfig.autoRetain?.enabled) : false;
  if (!agentsResult.valid) {
    console.error("[hindsight] autoRetain.agents is not an array — auto-retain disabled.");
  }
  return { enabled, agents: agentsResult.agents };
})(),
```

### 5. `SubagentRetainContext`

Reuses the same `CompactionContext` shape (the `client.session.messages` method is the same). Can be a type alias or a shared interface:

```typescript
export type SubagentRetainContext = {
  directory: string;
  client: {
    session: {
      messages: (params: { path: { id: string }; query: { directory: string } }) => Promise<{ data?: Array<{ info: any; parts?: Array<{ type: string; text?: string }> }> }>;
    };
  };
};
```

## Safety

1. **Error isolation**: All operations wrapped in try/catch. Never throw. Never block the host session.
2. **Dedup**: Session ID tracking prevents double-retain of the same session. Content hash dedup catches edge cases.
3. **Cooldown**: Per-agent cooldown (30s) prevents rapid re-retains from the same agent.
4. **Graceful skip**: If `ctx.client.session.messages()` fails (session already cleaned up), log a warning and return. No crash.
5. **No raw content in logs**: The `log()` calls must not include message content or previews. Only metadata (session ID, agent, bank source, content length, hash prefix).
6. **Config-gated**: `autoRetain.enabled` can disable the feature entirely without removing the code.

## Tests (TDD)

### Test File: `test/services/subagent-retain.test.ts`

1. **`createSubagentRetainHook` — ignores non-subagent session.deleted**
   - Fire `session.deleted` with no `parentID` → no `addMemory` call.

2. **`createSubagentRetainHook` — retains subagent last message**
   - Fire `session.deleted` with `parentID` set, mock `messages()` returning one assistant message with text parts.
   - Verify `addMemory` called with correct content and bank.

3. **`createSubagentRetainHook` — dedup by session ID**
   - Fire same `session.deleted` twice → only one `addMemory` call.

4. **`createSubagentRetainHook` — dedup by content hash**
   - Fire two different subagent sessions with identical content → only one `addMemory` call.

5. **`createSubagentRetainHook` — respects agent allowlist**
   - Set `agents: ["review-*"]`, fire session for `review-security` → retains.
   - Fire session for `builder` → skips.

6. **`createSubagentRetainHook` — empty agents = all agents**
   - Set `agents: []`, fire session for any agent → retains.

7. **`createSubagentRetainHook` — disabled config skips**
   - Set `enabled: false` → no `addMemory` call regardless of event.

8. **`createSubagentRetainHook` — messages API failure is graceful**
   - Mock `messages()` to throw → no crash, no `addMemory` call.

9. **`createSubagentRetainHook` — cooldown prevents rapid retains**
   - Fire two subagent completions for same agent within 30s → only one `addMemory` call.

10. **`createSubagentRetainHook` — no assistant message skips**
    - Mock `messages()` returning only user messages → no `addMemory` call.

### Test File: `test/index.test.ts` (additions)

11. **Plugin wires subagentRetainHook and compactionHook**
    - Verify both hooks are created and called on events.

### Test File: `test/config.test.ts` (additions)

12. **`autoRetain.enabled` defaults to true**
    - No config → `CONFIG.autoRetain.enabled === true`.

13. **`autoRetain.agents` defaults to empty array**
    - No config → `CONFIG.autoRetain.agents === []`.

14. **`autoRetain.agents` sanitizes entries**
    - Config with `[" review-* ", "  ", "builder"]` → `["review-*", "builder"]`.

## Implementation Order

1. Add config fields and sanitization in `src/config.ts` + tests.
2. Create `src/services/subagent-retain.ts` with full implementation.
3. Write failing tests in `test/services/subagent-retain.test.ts`.
4. Wire hook in `src/index.ts` + test.
5. Run `bun test`, `typecheck`, `build`.
6. Commit.

## Open Questions (Resolved)

- **Q**: Can we call `ctx.client.session.messages()` after `session.deleted`?
  - **A**: We try. If it fails, we skip gracefully. This is the simplest approach and matches the user's choice.
- **Q**: How do we get the agent name from a `Session` object?
  - **A**: We don't — we fetch messages and read `info.agent` or `info.mode` from the last assistant message.
- **Q**: Should we track `session.created` to pre-cache agent names?
  - **A**: No — the messages fetch at deletion time is simpler and the failure case is handled gracefully.
