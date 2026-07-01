# Brainstorm Research: Subagent Auto-Retain

## Overview

Research into automatically capturing subagent work into the subagent's mapped Hindsight project bank when a subagent never reaches compaction. Subagents are typically short-lived and never cross the 80% context threshold, so their work is silently lost unless the model explicitly calls `hindsight add`.

## OpenCode SDK Event Lifecycle

### Event Types

From `@opencode-ai/sdk` v1.14.19 types (`dist/v2/gen/types.gen.d.ts`):

**`session.deleted`** — fires when a session (including subagent sessions) is deleted:
```typescript
type EventSessionDeleted = {
  type: "session.deleted";
  properties: { sessionID: string; info: Session };
};
type Session = {
  id: string; slug: string; projectID: string;
  directory: string;
  parentID?: string;  // ← present on subagent sessions
  title: string; version: string;
  time: { created: number; updated: number; compacting?: number; archived?: number };
  // ...
};
```

**`message.updated`** — fires when a message is created/updated:
```typescript
type EventMessageUpdated = {
  type: "message.updated";
  properties: { sessionID: string; info: Message };
};
type AssistantMessage = {
  id: string; sessionID: string; role: "assistant";
  parentID: string; modelID: string; providerID: string;
  mode: string; agent: string;
  path: { cwd: string; root: string };
  summary?: boolean;
  finish?: string;  // string in SDK, truthy at runtime
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  // ...
};
```

**`session.created`** — fires when a session is created:
```typescript
type EventSessionCreated = {
  type: "session.created";
  properties: { sessionID: string; info: Session };
};
```

### Subagent Session Identification

- Subagent sessions have `Session.parentID` set to the parent session's ID.
- Root (main) sessions have `parentID: null`.
- `SubtaskPart` in the parent session records the subagent name, prompt, and description.
- The SDK `session.create` accepts an optional `parentID` parameter.

### Messages API

```typescript
ctx.client.session.messages({
  path: { id: sessionID },
  query: { directory: ctx.directory }
})
// Returns: Array<{ info: Message; parts: Array<Part> }>
```

## Existing Codebase Patterns

### Compaction Hook (`src/services/compaction.ts`)

- Handles `session.deleted` for state cleanup only (lines 164-171).
- Handles `message.updated` for compaction trigger and summary capture.
- `handleSummary()` fetches all session messages, finds the summary message, extracts text parts, and saves to the resolved project bank.
- Uses `firstString(info.agent, info.agentName, info.mode, fallbackAgent)` for agent extraction.
- Uses `resolveBanks({ directory, agent })` for bank routing.
- Error isolation: all operations wrapped in try/catch, never throws.

### Bank Routing (`src/services/tags.ts`)

- `resolveBanks({ directory, agent, projectBankAlias })` implements precedence:
  1. Agent exact/glob match from `agentProjectBanks`
  2. `HINDSIGHT_PROJECT_BANK_ID` env var
  3. `HINDSIGHT_BANK_ID` env var (legacy)
  4. Runtime project bank alias
  5. Config `projectBank` fallback
  6. Generated `p_<project>_<hash>` fallback

### Config (`src/config.ts`)

- `agentProjectBanks`: Record<string, string> — per-agent bank overrides with exact + `*` glob matching.
- `runtimeProjectBanks`: Record<string, string> — runtime alias map.
- `compactionThreshold`: number (default 0.80).
- `sanitizeBankMap()` validates and expands env refs.

### Hindsight Client (`src/services/client.ts`)

- `addMemory(content, bank, metadata, options)` — the write API.
- `addMemory` uses `retain()` under the hood with `async: true` by default.
- Metadata supports `type`, `tool`, and custom keys.
- Options support `documentId`, `tags`, `entities`, `updateMode`.

## Best Practices from Industry

### Capture Trigger
- Production systems capture at lifecycle hooks, never polling.
- AutoGen/Microsoft Agent Framework: `after_run()` / `PreToolUse` / `PostToolUse` / `SessionStart` / `Stop` hooks.
- Canonical trigger: agent completion / session end event.

### Content to Retain
- Strong consensus against storing raw full transcripts.
- Best practice: capture the final result message or a short structured summary.
- Episodic memory: "what happened" (event + outcome + timestamp).
- Semantic memory: distilled facts (optional secondary stage).

### Safety Patterns
- Content-hash dedup + semantic near-dup threshold.
- Per-agent cooldown window.
- Fire-and-forget with bounded retries and circuit-breaker.
- Error isolation: retain failure is logged, never crashes the plugin.
- Respect "no raw content/previews logged" rule.

## Key Design Decisions

1. **Trigger**: `session.deleted` with `parentID` check to identify subagent sessions.
2. **Content**: Last assistant message from the subagent session.
3. **Bank routing**: Reuse `resolveBanks({ directory, agent })` with agent from session info.
4. **Memory type**: `conversation` (consistent with existing compaction summaries).
5. **Dedup**: Session ID tracking + content hash dedup.
6. **Config**: `autoRetain.enabled` (bool) + `autoRetain.agents` (allowlist).
7. **Safety**: try/catch isolation, cooldown, never block host session.
