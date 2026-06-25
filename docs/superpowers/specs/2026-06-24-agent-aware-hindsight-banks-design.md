# Agent-Aware Hindsight Project Banks Design

## Goal

Add agent-aware Hindsight project bank routing to the `opencode-hindsight` plugin without changing OpenCode core.

## Problem

The plugin currently resolves banks once during plugin initialization. That makes every agent and subagent in the same OpenCode process use the same project bank, even when different subagents should recall and retain different project memories.

The desired behavior is:

- Main/default agent keeps using the default project bank.
- Named subagents can be mapped to specific project banks by exact name or glob pattern.
- Review agents can share one review bank through a pattern such as `review-*`.
- Tool calls can optionally use an explicit runtime bank alias for one-off cross-bank lookup, but only from a configured allowlist.
- No per-agent mutation of `process.env`.
- No arbitrary model-controlled bank IDs.

## Config Surface

Add two optional config maps to `~/.config/opencode/hindsight.jsonc`:

```jsonc
{
  "projectBank": "proj-default",

  "agentProjectBanks": {
    "review-*": "proj-review",
    "tdd": "proj-tdd",
    "builder": "proj-builder"
  },

  "runtimeProjectBanks": {
    "other-repo": "proj-other-repo",
    "review": "proj-review"
  }
}
```

`agentProjectBanks` controls automatic project-bank routing for recall/retain paths that carry an OpenCode agent name.

`runtimeProjectBanks` controls explicit per-tool-call overrides via an alias such as `bankAlias: "other-repo"`. The alias maps to a configured bank ID. The model never receives or supplies an arbitrary bank ID.

## Matching Rules

Agent matching uses these rules:

1. If no agent name is available, skip `agentProjectBanks` and use default project-bank behavior.
2. Exact `agentProjectBanks[agent]` matches first.
3. Glob patterns match second. Only `*` is supported as a wildcard.
4. Glob matches use object insertion order, so the first matching configured pattern wins.
5. Empty keys and empty bank values are ignored.

Examples:

- `agentProjectBanks["agent-a"] = "proj-agent-a"` routes only `agent-a`.
- `agentProjectBanks["review-*"] = "proj-review"` routes `review-security-skeptic`, `review-bug-hunter`, and other review agents to `proj-review`.
- Main/default agent with no mapping uses `projectBank` or generated default bank.

## Project Bank Precedence

For project-scoped operations, resolve the project bank in this order:

1. `HINDSIGHT_PROJECT_BANK_ID`
2. `HINDSIGHT_BANK_ID`
3. explicit runtime override alias from `runtimeProjectBanks`
4. matching `agentProjectBanks` exact/glob entry
5. `CONFIG.projectBank`
6. generated default `p_<project>_<hash>`

User bank behavior remains unchanged:

1. `CONFIG.userBank`
2. generated from git email or system username

Environment variables remain process-wide and retain highest priority. The implementation must not mutate them per agent.

## Runtime Override Rules

The `hindsight` tool gains an optional `bankAlias` argument.

Allowed:

```ts
hindsight(mode: "search", query: "auth flow", bankAlias: "other-repo")
```

Effects:

- Applies only to that tool call.
- Only selects aliases present in `runtimeProjectBanks`.
- Works for project-scoped operations and combined user+project search.

Rejected:

```ts
hindsight(mode: "search", query: "auth flow", bankId: "proj-anything")
```

The plugin must not add a raw `bankId` tool argument.

If `bankAlias` is unknown, return a structured tool error instead of silently falling back.

## Code Architecture

### `src/config.ts`

Extend `HindsightConfig` and `CONFIG` with sanitized maps:

- `agentProjectBanks: Record<string, string>`
- `runtimeProjectBanks: Record<string, string>`

Sanitization keeps only non-empty string keys and values.

### `src/services/tags.ts`

Add a per-call resolver:

```ts
export interface ResolveBanksInput {
  directory: string;
  agent?: string | null;
  projectBankAlias?: string | null;
}

export interface ResolvedBanks {
  user: string;
  project: string;
  projectSource: string;
  agent?: string;
  projectBankAlias?: string;
  agentPattern?: string;
}

export function resolveBanks(input: ResolveBanksInput): ResolvedBanks;
```

Keep `getBanks(directory)` as a backwards-compatible wrapper around `resolveBanks({ directory })`.

### `src/index.ts`

Stop using an init-time `const banks = getBanks(directory)` for runtime operations.

Resolve banks inside each operation:

- `chat.message`: resolve with agent metadata from hook input/output.
- `hindsight` tool execute: resolve with `context.agent` and optional `args.bankAlias`.

Add safe debug logging for `agent`, `projectBankSource`, alias, and matched pattern. Do not log secrets.

### `src/services/compaction.ts`

Replace fixed init-time banks with a resolver callback. Resolve the project bank per compaction event using `info.agent` or summary-message metadata when available.

If no agent is available, fallback remains default project-bank behavior.

## Testing

Add Bun tests for pure resolver behavior:

- default fallback when no agent mapping matches
- exact agent mapping
- glob agent mapping
- exact mapping takes precedence over glob mapping
- runtime alias takes precedence over agent mapping
- unknown runtime alias is rejected
- environment variable precedence over alias/agent/config

Run:

```bash
bun test
bun run typecheck
bun run build
```

## Live Smoke Test

After implementation and plugin restart, run a live OpenCode smoke test:

1. Configure a temporary `agentProjectBanks` entry for a review subagent.
2. Spawn a matching review subagent.
3. Call `hindsight(mode: "help")` and a read-only `hindsight(mode: "list", scope: "project", limit: 1)`.
4. Inspect plugin logs for the resolved agent and bank source.

This validates OpenCode's runtime metadata path without relying on the model prompt or environment variables to expose the subagent name.

## Backwards Compatibility

No config changes are required for existing users.

When `agentProjectBanks` and `runtimeProjectBanks` are unset, behavior remains the existing default: configured project bank or generated project bank.

The plugin remains an OpenCode extension change only; no OpenCode core change is required.
