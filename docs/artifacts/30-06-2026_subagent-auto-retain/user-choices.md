# User Choices: Subagent Auto-Retain

## Decision Log

| ID | Decision | Value | Rationale |
|---|---|---|---|
| DEC-001 | Capture trigger | `session.deleted` | Cleanest signal — fires exactly once per subagent session. `parentID` field identifies subagent sessions. |
| DEC-002 | Content shape | Last assistant message | Lightweight, avoids memory pollution. Aligns with best practices against storing raw transcripts. |
| DEC-003 | Memory type | `conversation` | Consistent with existing compaction summaries. No new type needed. |
| DEC-004 | Config: enable | `autoRetain.enabled` (bool, default true) | Master switch to disable auto-retain without removing the feature. |
| DEC-005 | Config: allowlist | `autoRetain.agents` (string[], empty = all) | Allows operators to scope auto-retain to specific agent patterns. Supports `*` glob. |
| DEC-006 | Dedup strategy | Session ID + content hash | Primary: track retained session IDs. Secondary: hash content to catch edge cases. |
| DEC-007 | Subagent identification | `parentID` check on `session.deleted` | `Session.parentID` is the canonical way to distinguish subagent from root sessions. |
| DEC-008 | Messages fetch | `ctx.client.session.messages()` at deletion time | Attempt to fetch messages when `session.deleted` fires. If the API fails, skip gracefully. |
| DEC-009 | Review mode | Adversarial plan review | Autonomous after spec approval; no human gate between spec and PR. |
| DEC-010 | Workspace | Worktree at `../opencode-hindsight-subagent-retain` on `feat/subagent-auto-retain` | Isolated feature branch from `origin/main`. |

## Prior Decisions (Reused)

| ID | Decision | Source |
|---|---|---|
| PRIOR-001 | Bank routing via `resolveBanks({ directory, agent })` | Agent-aware banks feature |
| PRIOR-002 | Agent extraction via `firstString(info.agent, info.agentName, info.mode)` | Compaction hook |
| PRIOR-003 | Error isolation: try/catch, never throw, never block host | Existing plugin pattern |
| PRIOR-004 | Raw content/previews must NOT be logged | Existing project constraint |
| PRIOR-005 | TDD: failing test first, verify red, then implement | Project preference |
