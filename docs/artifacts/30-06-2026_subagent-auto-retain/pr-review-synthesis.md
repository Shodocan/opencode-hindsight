# Adversarial PR Review Synthesis — Subagent Auto-Retain

## Metadata

| Field | Value |
|---|---|
| PR | #2 — feat/subagent-auto-retain |
| Head SHA | add3f74d |
| Base | main |
| Repository | opencode-hindsight |
| Review Date | 2026-07-01 |
| Pipeline | Tier 3 High-Risk (full canonical v3) |

## Verdict

**changes_requested**

## Promoted Findings

### C-001 — Fire-and-forget state race (HIGH → promoted by judge override)

**Description**: State updates (retainedSessionIDs, retainedContentHashes, cooldownTimestamps) are deferred to the `.then()` callback of the fire-and-forget `addMemory` promise. Two concurrent `session.deleted` events for the same session can both pass the synchronous dedup checks before the first `.then()` runs, causing duplicate retains.

**Gate A**: KILLED (refuter argued session deleted exactly once, Set.add idempotent)
**Gate B**: PASS (verifier confirmed structural race)
**Judge**: PROMOTED — refuter's Set.add/idempotence argument does not address in-flight duplication; state is updated only after async success

**Fix**: Move state updates (session ID, content hash, cooldown) before the fire-and-forget `addMemory` call, not inside `.then()`. On failure, remove session ID to allow retry.

### C-019 — Awaited messages fetch blocks event pipeline (HIGH → promoted by judge override)

**Description**: `await ctx.client.session.messages(...)` blocks the entire event pipeline. The `session.deleted` event handler cannot return until the messages API responds.

**Gate A**: KILLED (refuter argued structurally necessary await, cold path, local IPC)
**Gate B**: PASS (verifier confirmed structural blocking)
**Judge**: PROMOTED — refuter's cold-path/local-IPC rationale does not satisfy the non-blocking acceptance criterion

**Fix**: Move the messages-fetch/retain workflow behind a try/catch-isolated fire-and-forget task so the `session.deleted` hook returns promptly.

### C-026 — Non-array agents silently = all agents (HIGH → promoted by judge override)

**Description**: `sanitizeAutoRetainAgents` returns `[]` for non-array input, which `matchAgent` interprets as "all agents". A user writing `agents: "review-*"` (string instead of array) would silently enable retain for all agents.

**Gate A**: KILLED (refuter argued non-array falls back to documented default)
**Gate B**: PASS (verifier confirmed behavior exists)
**Judge**: PROMOTED — explicit malformed non-array config is not the same as the frozen documented empty=all default

**Fix**: Treat explicitly non-array configured values as invalid and fail closed or disable auto-retain for that invalid allowlist.

## Pipeline Summary

| Stage | Count |
|---|---|
| Scouts | 3 (context, code, docs) |
| Finder waves | 2 (20 finders total) |
| Final GPT finder | 1 |
| Consolidator passes | 2 |
| Gate B (verifier) | 7 HIGH findings verified |
| Gate A (refuter) | 5 HIGH findings refuted |
| Judge adjudications | 3 promoted (judge override) |
| Total unique findings | 48 (7 HIGH, 41 MEDIUM) |
| Promoted | 3 |
| Killed | 4 HIGH + 41 MEDIUM (unverified) |

## Key Refutations

| Finding | Verdict | Reason |
|---|---|---|
| C-002 (Summary filter) | KILLED | SDK types `summary` as boolean, producer uses strict boolean |
| C-003 (Duplicated utilities) | KILLED | Small stable functions, intentional module isolation |
| C-017 (Empty session ID) | KILLED | `if (!sessionID) return;` catches empty strings |
| C-018 (Directory override) | KILLED | SDK-controlled, only used in last-resort fallback |

## Acceptance Criteria Assessment

| Criterion | Status |
|---|---|
| Subagent last message retained to agent-routed bank on session.deleted | ✅ Met |
| No raw content in logs | ✅ Met (metadata only) |
| Never blocks host | ⚠️ C-019 — messages fetch awaited |
| Config-gated | ✅ Met |
| Per-bank dedup | ✅ Met |
| Cooldown prevents rapid retains | ✅ Met |
| Compaction summaries skipped | ✅ Met |

## Human Choice Protection

No findings conflict with frozen user choices (DEC-001..010, PRIOR-001..005). All human choices are correctly implemented.

## Dispatch Proof

| Stage | Subagent | Status |
|---|---|---|
| Advisor | task-advisor | ✅ Completed |
| Scout: context | review-scout-context-codex | ✅ Completed |
| Scout: code | review-scout-code-codex | ✅ Completed |
| Scout: docs | review-scout-docs-codex | ✅ Completed |
| Finder wave 1 | 10 finders (bug-hunter, security-skeptic, correctness, regression-sentinel, test-gap-finder, error-path-auditor, concurrency-sleuth, maintainability-critic, data-integrity-auditor, multimodel-codex) | ✅ Completed |
| Finder wave 2 | 10 finders (edge-case-hunter, performance-profiler, config-auditor, dependency-risk-auditor, readability, observability-scout, shell-safety-auditor, api-contract-checker, tests) | ✅ Completed |
| Final GPT finder | review-final-gpt-finder | ✅ Completed |
| Consolidator | review-consolidator (2 passes) | ✅ Completed |
| Gate B | review-verifier-glm (7 HIGH findings) | ✅ Completed |
| Gate A | review-refuter-deepseek (5 HIGH findings) | ✅ Completed |
| Judge | review-judge | ✅ Completed |
