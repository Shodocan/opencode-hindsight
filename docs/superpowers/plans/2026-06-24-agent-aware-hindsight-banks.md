# Agent-Aware Hindsight Banks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Hindsight project memories by OpenCode agent/subagent name, with allowlisted per-tool-call runtime bank aliases and unchanged default behavior.

**Architecture:** Add sanitized config maps, move project-bank selection into a per-call resolver, and thread that resolver through chat hooks, tool execution, and compaction hooks. Automatic recall/retain uses agent-name mapping; explicit one-off tool calls can select configured aliases only.

**Tech Stack:** TypeScript, Bun test runner, OpenCode plugin API, `@vectorize-io/hindsight-client`.

---

## Constraints

- No OpenCode core changes.
- Do not mutate `process.env` per agent.
- Do not expose arbitrary bank IDs as model-controlled tool arguments.
- Preserve default behavior when no agent or runtime mapping matches.
- Keep each implementation task under ~5 touched files and ~200 changed lines.
- For write-capable implementation tasks, use the `subagent-task-harness` skill: run `generate-prompt` to produce the dispatch prompt, then `check-result` after the subagent returns.

## File Structure

- Modify: `package.json` — add `test` script.
- Modify: `src/config.ts` — add typed/sanitized `agentProjectBanks` and `runtimeProjectBanks` config maps.
- Modify: `src/services/tags.ts` — add pure bank resolver, exact/glob matching, runtime alias validation, and env precedence.
- Create: `test/services/tags.test.ts` — resolver unit tests.
- Modify: `src/index.ts` — resolve banks per chat message/tool call; add `bankAlias` tool argument.
- Modify: `src/services/compaction.ts` — resolve banks per compaction event/summary instead of fixed init-time banks.
- Modify: `README.md` — document agent mapping and runtime aliases.

---

## Task 1: Add Resolver Tests and Test Script

**Files:**
- Modify: `package.json`
- Create: `test/services/tags.test.ts`

**Subagent dispatch prompt:**

```text
GOAL: Add failing resolver tests for agent-aware Hindsight project bank routing.
FILES:
- Modify: package.json
- Create: test/services/tags.test.ts
INSTRUCTIONS:
1. Add a package script: "test": "bun test".
2. Create test/services/tags.test.ts with the exact resolver tests below.
3. Do not implement resolver code in this task beyond what is necessary if TypeScript import paths require adjustment.
CONSTRAINTS:
- Stay within the declared file touch set.
- Stop instead of broadening scope.
VALIDATION:
- bun test test/services/tags.test.ts
- Expected before implementation: FAIL because resolveBanks does not yet accept the tested options/metadata.
STOP: DONE after tests are written and the expected failure is observed; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Add the Bun test script**

Modify `package.json` so the `scripts` block contains:

```json
{
  "build": "bun build ./src/index.ts --outdir ./dist --target node && bun build ./src/cli.ts --outfile ./dist/cli.js --target node && tsc --emitDeclarationOnly",
  "dev": "tsc --watch",
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

- [ ] **Step 2: Create resolver tests**

Create `test/services/tags.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { resolveBanks, type BankRoutingConfig } from "../../src/services/tags";

const directory = "/tmp/opencode/project-alpha";

function config(overrides: Partial<BankRoutingConfig> = {}): BankRoutingConfig {
  return {
    bankPrefix: "opencode",
    userBank: "test-user-bank",
    agentProjectBanks: {},
    runtimeProjectBanks: {},
    ...overrides,
  };
}

describe("resolveBanks", () => {
  test("uses generated project bank when no env, alias, agent mapping, or projectBank exists", () => {
    const banks = resolveBanks(
      { directory, agent: "main" },
      { config: config(), env: {} }
    );

    expect(banks.user).toBe("test-user-bank");
    expect(banks.project).toMatch(/^p_project-alpha_[a-f0-9]{16}$/);
    expect(banks.projectSource).toBe("generated");
  });

  test("uses config projectBank when no agent mapping matches", () => {
    const banks = resolveBanks(
      { directory, agent: "main" },
      { config: config({ projectBank: "proj-default" }), env: {} }
    );

    expect(banks.project).toBe("proj-default");
    expect(banks.projectSource).toBe("config:projectBank");
  });

  test("uses exact agentProjectBanks match", () => {
    const banks = resolveBanks(
      { directory, agent: "tdd" },
      {
        config: config({
          projectBank: "proj-default",
          agentProjectBanks: { tdd: "proj-tdd" },
        }),
        env: {},
      }
    );

    expect(banks.project).toBe("proj-tdd");
    expect(banks.projectSource).toBe("agentProjectBanks");
    expect(banks.agentPattern).toBe("tdd");
  });

  test("uses glob agentProjectBanks match", () => {
    const banks = resolveBanks(
      { directory, agent: "review-security-skeptic" },
      {
        config: config({
          projectBank: "proj-default",
          agentProjectBanks: { "review-*": "proj-review" },
        }),
        env: {},
      }
    );

    expect(banks.project).toBe("proj-review");
    expect(banks.projectSource).toBe("agentProjectBanks");
    expect(banks.agentPattern).toBe("review-*");
  });

  test("exact agent mapping beats glob mapping", () => {
    const banks = resolveBanks(
      { directory, agent: "review-security-skeptic" },
      {
        config: config({
          agentProjectBanks: {
            "review-*": "proj-review",
            "review-security-skeptic": "proj-security-review",
          },
        }),
        env: {},
      }
    );

    expect(banks.project).toBe("proj-security-review");
    expect(banks.agentPattern).toBe("review-security-skeptic");
  });

  test("runtime alias beats agent mapping", () => {
    const banks = resolveBanks(
      { directory, agent: "review-security-skeptic", projectBankAlias: "other-repo" },
      {
        config: config({
          agentProjectBanks: { "review-*": "proj-review" },
          runtimeProjectBanks: { "other-repo": "proj-other-repo" },
        }),
        env: {},
      }
    );

    expect(banks.project).toBe("proj-other-repo");
    expect(banks.projectSource).toBe("runtimeProjectBanks");
    expect(banks.projectBankAlias).toBe("other-repo");
  });

  test("unknown runtime alias is rejected", () => {
    expect(() =>
      resolveBanks(
        { directory, agent: "review-security-skeptic", projectBankAlias: "missing" },
        { config: config({ runtimeProjectBanks: { review: "proj-review" } }), env: {} }
      )
    ).toThrow("Unknown runtime project bank alias: missing");
  });

  test("HINDSIGHT_PROJECT_BANK_ID beats alias, agent mapping, and config projectBank", () => {
    const banks = resolveBanks(
      { directory, agent: "review-security-skeptic", projectBankAlias: "other-repo" },
      {
        config: config({
          projectBank: "proj-default",
          agentProjectBanks: { "review-*": "proj-review" },
          runtimeProjectBanks: { "other-repo": "proj-other-repo" },
        }),
        env: { HINDSIGHT_PROJECT_BANK_ID: "proj-env" },
      }
    );

    expect(banks.project).toBe("proj-env");
    expect(banks.projectSource).toBe("env:HINDSIGHT_PROJECT_BANK_ID");
  });

  test("HINDSIGHT_BANK_ID is used when HINDSIGHT_PROJECT_BANK_ID is unset", () => {
    const banks = resolveBanks(
      { directory, agent: "review-security-skeptic" },
      {
        config: config({
          projectBank: "proj-default",
          agentProjectBanks: { "review-*": "proj-review" },
        }),
        env: { HINDSIGHT_BANK_ID: "proj-bank-env" },
      }
    );

    expect(banks.project).toBe("proj-bank-env");
    expect(banks.projectSource).toBe("env:HINDSIGHT_BANK_ID");
  });
});
```

- [ ] **Step 3: Run the focused test and confirm expected failure**

Run:

```bash
bun test test/services/tags.test.ts
```

Expected: `FAIL` because `resolveBanks` and `BankRoutingConfig` are not implemented yet.

---

## Task 2: Implement Config Maps and Pure Bank Resolver

**Files:**
- Modify: `src/config.ts`
- Modify: `src/services/tags.ts`
- Modify: `test/services/tags.test.ts` only if import path adjustment is required

**Subagent dispatch prompt:**

```text
GOAL: Implement typed config maps and per-call bank resolver for agent-aware project banks.
FILES:
- Modify: src/config.ts
- Modify: src/services/tags.ts
- Modify: test/services/tags.test.ts
INSTRUCTIONS:
1. Add agentProjectBanks and runtimeProjectBanks to config with sanitized non-empty string maps.
2. Implement resolveBanks with env > runtime alias > agent mapping > projectBank > generated precedence.
3. Keep getBanks(directory) as a backwards-compatible wrapper.
4. Make the tests from Task 1 pass.
CONSTRAINTS:
- Stay within the declared file touch set.
- Do not modify plugin hook/tool call sites in this task.
VALIDATION:
- bun test test/services/tags.test.ts
- bun run typecheck
- Expected: both pass.
STOP: DONE when validation passes; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Extend config types and sanitization**

In `src/config.ts`, add fields to `HindsightConfig`:

```ts
  agentProjectBanks?: Record<string, string>;
  runtimeProjectBanks?: Record<string, string>;
```

Update `DEFAULTS` so these optional maps are not required:

```ts
const DEFAULTS: Required<
  Omit<
    HindsightConfig,
    "userBank" | "projectBank" | "baseUrl" | "agentProjectBanks" | "runtimeProjectBanks"
  >
> = {
```

Add this helper below `validateCompactionThreshold`:

```ts
function sanitizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawValue !== "string") continue;

    const key = rawKey.trim();
    const mapValue = rawValue.trim();
    if (!key || !mapValue) continue;

    result[key] = mapValue;
  }

  return result;
}
```

Add sanitized maps to `CONFIG`:

```ts
  agentProjectBanks: sanitizeStringMap(fileConfig.agentProjectBanks),
  runtimeProjectBanks: sanitizeStringMap(fileConfig.runtimeProjectBanks),
```

- [ ] **Step 2: Implement resolver types and helpers**

In `src/services/tags.ts`, replace the simple project-bank functions with resolver support while preserving exports:

```ts
export interface BankRoutingConfig {
  bankPrefix: string;
  userBank?: string;
  projectBank?: string;
  agentProjectBanks?: Record<string, string>;
  runtimeProjectBanks?: Record<string, string>;
}

export interface ResolveBanksInput {
  directory: string;
  agent?: string | null;
  projectBankAlias?: string | null;
}

export interface ResolveBanksOptions {
  config?: BankRoutingConfig;
  env?: Record<string, string | undefined>;
}

export interface ResolvedBanks {
  user: string;
  project: string;
  projectSource: string;
  agent?: string;
  projectBankAlias?: string;
  agentPattern?: string;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globMatches(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(value);
}

function findAgentProjectBank(
  agent: string | undefined,
  mappings: Record<string, string> | undefined
): { bank: string; pattern: string } | undefined {
  if (!agent || !mappings) return undefined;

  const exact = nonEmpty(mappings[agent]);
  if (exact) return { bank: exact, pattern: agent };

  for (const [rawPattern, rawBank] of Object.entries(mappings)) {
    const pattern = rawPattern.trim();
    const bank = nonEmpty(rawBank);
    if (!pattern || !bank || !pattern.includes("*")) continue;
    if (globMatches(pattern, agent)) return { bank, pattern };
  }

  return undefined;
}
```

- [ ] **Step 3: Implement project-bank precedence**

Add this resolver logic in `src/services/tags.ts`:

```ts
function getProjectName(directory: string): string {
  return directory.split("/").filter(Boolean).pop() || "unknown";
}

function resolveProjectBank(
  input: ResolveBanksInput,
  routingConfig: BankRoutingConfig,
  env: Record<string, string | undefined>
): Omit<ResolvedBanks, "user"> {
  const envProjectBank = nonEmpty(env.HINDSIGHT_PROJECT_BANK_ID);
  if (envProjectBank) {
    return { project: envProjectBank, projectSource: "env:HINDSIGHT_PROJECT_BANK_ID" };
  }

  const envBank = nonEmpty(env.HINDSIGHT_BANK_ID);
  if (envBank) {
    return { project: envBank, projectSource: "env:HINDSIGHT_BANK_ID" };
  }

  const projectBankAlias = nonEmpty(input.projectBankAlias ?? undefined);
  if (projectBankAlias) {
    const runtimeBank = nonEmpty(routingConfig.runtimeProjectBanks?.[projectBankAlias]);
    if (!runtimeBank) {
      throw new Error(`Unknown runtime project bank alias: ${projectBankAlias}`);
    }
    return {
      project: runtimeBank,
      projectSource: "runtimeProjectBanks",
      projectBankAlias,
    };
  }

  const agent = nonEmpty(input.agent ?? undefined);
  const agentMapping = findAgentProjectBank(agent, routingConfig.agentProjectBanks);
  if (agentMapping) {
    return {
      project: agentMapping.bank,
      projectSource: "agentProjectBanks",
      agent,
      agentPattern: agentMapping.pattern,
    };
  }

  const configuredProjectBank = nonEmpty(routingConfig.projectBank);
  if (configuredProjectBank) {
    return { project: configuredProjectBank, projectSource: "config:projectBank", agent };
  }

  const projectName = getProjectName(input.directory);
  return {
    project: `p_${projectName}_${sha256(input.directory)}`,
    projectSource: "generated",
    agent,
  };
}

export function resolveBanks(
  input: ResolveBanksInput,
  options: ResolveBanksOptions = {}
): ResolvedBanks {
  const routingConfig = options.config ?? CONFIG;
  const env = options.env ?? process.env;
  const project = resolveProjectBank(input, routingConfig, env);

  return {
    user: getUserBank(routingConfig),
    ...project,
  };
}
```

Update `getUserBank`, `getProjectBank`, and `getBanks` to use optional config while keeping their public behavior:

```ts
export function getUserBank(routingConfig: BankRoutingConfig = CONFIG): string {
  const configuredUserBank = nonEmpty(routingConfig.userBank);
  if (configuredUserBank) return configuredUserBank;

  const email = getGitEmail();
  if (email) return `${routingConfig.bankPrefix}_user_${sha256(email)}`;

  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  return `${routingConfig.bankPrefix}_user_${sha256(fallback)}`;
}

export function getProjectBank(directory: string): string {
  return resolveBanks({ directory }).project;
}

export function getBanks(directory: string): { user: string; project: string } {
  const banks = resolveBanks({ directory });
  return { user: banks.user, project: banks.project };
}
```

- [ ] **Step 4: Run resolver validation**

Run:

```bash
bun test test/services/tags.test.ts
bun run typecheck
```

Expected: tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit checkpoint**

Run after validation passes:

```bash
git add package.json src/config.ts src/services/tags.ts test/services/tags.test.ts
git commit -m "feat: add agent-aware bank resolver"
```

---

## Task 3: Apply Resolver to Chat Hooks and Hindsight Tool Calls

**Files:**
- Modify: `src/index.ts`
- Modify: `test/services/tags.test.ts` only if resolver API changed in Task 2

**Subagent dispatch prompt:**

```text
GOAL: Resolve Hindsight banks per chat.message and hindsight tool call, including allowlisted bankAlias support.
FILES:
- Modify: src/index.ts
- Modify: test/services/tags.test.ts
INSTRUCTIONS:
1. Import resolveBanks instead of using init-time getBanks for runtime operations.
2. Add bankAlias to the hindsight tool schema and args type.
3. Extract agent name from tool execute context and chat hook metadata using safe unknown-object inspection.
4. Resolve banks inside chat.message and execute, return structured error for unknown bankAlias.
CONSTRAINTS:
- Stay within the declared file touch set.
- Do not modify compaction in this task.
VALIDATION:
- bun test
- bun run typecheck
- Expected: both pass.
STOP: DONE when validation passes; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Update imports**

In `src/index.ts`, replace:

```ts
import { getBanks } from "./services/tags.js";
```

with:

```ts
import { resolveBanks, type ResolvedBanks } from "./services/tags.js";
```

- [ ] **Step 2: Add safe agent extraction helper**

Add this helper near the other local helper functions in `src/index.ts`:

```ts
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function extractAgentName(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) continue;

    const info = asRecord(record.info);
    const message = asRecord(record.message);
    const context = asRecord(record.context);

    const agent = firstString(
      record.agent,
      record.agentName,
      info?.agent,
      info?.agentName,
      message?.agent,
      message?.agentName,
      context?.agent,
      context?.agentName
    );

    if (agent) return agent;
  }
  return undefined;
}

function resolveForOperation(
  directory: string,
  agent?: string,
  projectBankAlias?: string | null
): ResolvedBanks {
  return resolveBanks({ directory, agent, projectBankAlias });
}
```

- [ ] **Step 3: Remove runtime use of init-time banks**

In `HindsightPlugin`, replace:

```ts
  const banks = getBanks(directory);
  const injectedSessions = new Set<string>();
  log("Plugin init", { directory, banks, configured: isConfigured() });
```

with:

```ts
  const defaultBanks = resolveBanks({ directory });
  const injectedSessions = new Set<string>();
  log("Plugin init", {
    directory,
    banks: { user: defaultBanks.user, project: defaultBanks.project },
    projectBankSource: defaultBanks.projectSource,
    configured: isConfigured(),
  });
```

- [ ] **Step 4: Resolve banks inside `chat.message`**

Inside the `chat.message` handler, after `const start = Date.now();`, add:

```ts
      const agent = extractAgentName(input, output, output?.message);
      const banks = resolveForOperation(directory, agent);
```

Extend the existing processing log to include safe routing metadata:

```ts
        log("chat.message: processing", {
          messagePreview: userMessage.slice(0, 100),
          partsCount: output.parts.length,
          textPartsCount: textParts.length,
          agent,
          projectBankSource: banks.projectSource,
          agentPattern: banks.agentPattern,
        });
```

Keep the existing Hindsight calls using this per-message `banks` value:

```ts
hindsightClient.getProfile(banks.user, userMessage)
hindsightClient.searchMemories(userMessage, banks.user)
hindsightClient.listMemories(banks.project, CONFIG.maxProjectMemories)
```

- [ ] **Step 5: Add `bankAlias` tool argument and execute context**

In the `hindsight` tool schema, add:

```ts
          bankAlias: tool.schema.string().optional(),
```

Update execute signature:

```ts
        async execute(args: {
          mode?: string;
          content?: string;
          query?: string;
          type?: MemoryType;
          scope?: MemoryScope;
          memoryId?: string;
          limit?: number;
          bankAlias?: string;
        }, context?: unknown) {
```

After `if (!isConfigured())` and before the switch, resolve banks:

```ts
          const agent = extractAgentName(context, args);
          let banks: ResolvedBanks;
          try {
            banks = resolveForOperation(directory, agent, args.bankAlias);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return JSON.stringify({ success: false, error: msg });
          }

          if (args.bankAlias && args.scope === "user") {
            return JSON.stringify({
              success: false,
              error: "bankAlias applies only to project-scoped or combined project/user operations",
            });
          }

          log("tool.execute: routing", {
            mode,
            agent,
            bankAlias: args.bankAlias,
            projectBankSource: banks.projectSource,
            agentPattern: banks.agentPattern,
          });
```

Update help response to list aliases, not raw bank IDs:

```ts
                  bankAliases: Object.keys(CONFIG.runtimeProjectBanks),
```

Keep all existing add/search/profile/list/forget logic using the per-call `banks` variable.

- [ ] **Step 6: Run validation**

Run:

```bash
bun test
bun run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit checkpoint**

Run after validation passes:

```bash
git add src/index.ts test/services/tags.test.ts
git commit -m "feat: route hindsight tool calls by agent"
```

---

## Task 4: Apply Resolver to Compaction Hooks

**Files:**
- Modify: `src/services/compaction.ts`
- Modify: `src/index.ts`

**Subagent dispatch prompt:**

```text
GOAL: Make compaction recall/summary persistence resolve project banks per event agent metadata.
FILES:
- Modify: src/services/compaction.ts
- Modify: src/index.ts
INSTRUCTIONS:
1. Change createCompactionHook to accept a bank resolver callback instead of fixed banks.
2. Resolve project memories and summary persistence using info.agent or summary message agent metadata.
3. Update HindsightPlugin to pass the resolver callback.
CONSTRAINTS:
- Stay within the declared file touch set.
- Preserve existing compaction behavior when no agent metadata exists.
VALIDATION:
- bun test
- bun run typecheck
- Expected: both pass.
STOP: DONE when validation passes; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Update compaction imports and types**

In `src/services/compaction.ts`, import resolver type:

```ts
import type { ResolvedBanks } from "./tags.js";
```

Add this exported type near interfaces:

```ts
export type CompactionBankResolver = (input?: { agent?: string | null }) => ResolvedBanks;
```

Change function signature from:

```ts
export function createCompactionHook(
  ctx: CompactionContext,
  banks: { user: string; project: string },
  options?: CompactionOptions
) {
```

to:

```ts
export function createCompactionHook(
  ctx: CompactionContext,
  resolveBanksForCompaction: CompactionBankResolver,
  options?: CompactionOptions
) {
```

- [ ] **Step 2: Resolve bank for project-memory fetch**

Replace `fetchProjectMemoriesForCompaction()` with:

```ts
  async function fetchProjectMemoriesForCompaction(agent?: string | null): Promise<string[]> {
    try {
      const banks = resolveBanksForCompaction({ agent });
      const result = await hindsightClient.listMemories(banks.project, CONFIG.maxProjectMemories);
      const documents = result.documents || [];
      return documents.map((m: any) => m.text || m.content || m.summary || "").filter(Boolean);
    } catch (err) {
      log("[compaction] failed to fetch project memories", { error: String(err), agent });
      return [];
    }
  }
```

- [ ] **Step 3: Resolve bank for summary persistence**

Change `handleSummary` signature:

```ts
  async function handleSummary(sessionID: string, fallbackAgent?: string | null): Promise<void> {
```

Inside the `if (summaryMessage?.parts)` block, before `addMemory`, add:

```ts
          const summaryAgent = summaryMessage.info?.agent ?? fallbackAgent;
          const banks = resolveBanksForCompaction({ agent: summaryAgent });
```

Then replace `banks.project` in `addMemory` with the local `banks.project`, and extend log metadata:

```ts
          log("[compaction] summary saved as memory", {
            sessionID,
            agent: summaryAgent,
            projectBankSource: banks.projectSource,
          });
```

- [ ] **Step 4: Pass event agent into compaction operations**

In the `message.updated` event branch, after `const info = props?.info as any;`, add:

```ts
        const agent = typeof info.agent === "string" ? info.agent : undefined;
```

Update summary handling:

```ts
          await handleSummary(sessionID, agent);
```

Update project-memory fetch:

```ts
          const projectMemories = await fetchProjectMemoriesForCompaction(agent);
```

- [ ] **Step 5: Update `src/index.ts` compaction hook construction**

Replace:

```ts
    ? createCompactionHook(ctx as CompactionContext, banks, {
```

with:

```ts
    ? createCompactionHook(
        ctx as CompactionContext,
        ({ agent } = {}) => resolveForOperation(directory, agent ?? undefined),
        {
```

Ensure the closing parentheses still match:

```ts
        }
      )
```

- [ ] **Step 6: Run validation**

Run:

```bash
bun test
bun run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 7: Commit checkpoint**

Run after validation passes:

```bash
git add src/services/compaction.ts src/index.ts
git commit -m "feat: route compaction memories by agent"
```

---

## Task 5: Document Config and Run Full Build

**Files:**
- Modify: `README.md`

**Subagent dispatch prompt:**

```text
GOAL: Document agent-aware bank routing and runtime bank aliases, then run full validation.
FILES:
- Modify: README.md
INSTRUCTIONS:
1. Add agentProjectBanks and runtimeProjectBanks examples to the configuration section.
2. Document precedence, automatic subagent routing, and bankAlias safety rules.
3. Run full validation.
CONSTRAINTS:
- Stay within the declared file touch set.
- Do not edit README_CN unless explicitly requested by the orchestrator.
VALIDATION:
- bun test
- bun run typecheck
- bun run build
- Expected: all pass.
STOP: DONE when validation passes; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Update config example**

In `README.md`, extend the JSONC example under `## Configuration` after `projectBank`:

```jsonc
  // Optional: Route specific agents/subagents to project banks by exact name or glob
  "agentProjectBanks": {
    "review-*": "proj-review",
    "tdd": "proj-tdd"
  },

  // Optional: Allowlisted per-tool-call project bank aliases
  "runtimeProjectBanks": {
    "other-repo": "proj-other-repo",
    "review": "proj-review"
  },
```

- [ ] **Step 2: Add agent routing docs**

Under `### Bank Selection`, add:

```md
### Agent-Aware Project Bank Routing

Subagents can use different project banks without changing OpenCode core. Configure `agentProjectBanks` with exact names or `*` glob patterns:

```jsonc
{
  "projectBank": "proj-default",
  "agentProjectBanks": {
    "review-*": "proj-review",
    "agent-a": "proj-agent-a",
    "agent-b": "proj-agent-b"
  }
}
```

With this configuration:

- the main/default agent uses `proj-default`
- `agent-a` uses `proj-agent-a`
- `agent-b` uses `proj-agent-b`
- `review-security-skeptic`, `review-bug-hunter`, and other `review-*` agents use `proj-review`

Exact agent matches take precedence over glob patterns. If no agent mapping matches, the plugin falls back to `projectBank` or the generated project bank.
```

- [ ] **Step 3: Add runtime alias docs**

After the agent routing docs, add:

```md
### Runtime Project Bank Aliases

For one-off tool calls, configure allowlisted aliases with `runtimeProjectBanks`:

```jsonc
{
  "runtimeProjectBanks": {
    "other-repo": "proj-other-repo"
  }
}
```

Then call:

```text
hindsight(mode: "search", query: "auth flow", bankAlias: "other-repo")
```

`bankAlias` applies only to that tool call. Unknown aliases return an error. The tool does not accept arbitrary bank IDs from the model.
```

- [ ] **Step 4: Add precedence docs**

Update the configuration loading/bank selection section with:

```md
Project bank precedence, highest to lowest:

1. `HINDSIGHT_PROJECT_BANK_ID`
2. `HINDSIGHT_BANK_ID`
3. allowlisted `bankAlias` from `runtimeProjectBanks`
4. matching `agentProjectBanks` exact/glob entry
5. `projectBank`
6. generated `p_<project>_<hash>` bank
```

- [ ] **Step 5: Run full validation**

Run:

```bash
bun test
bun run typecheck
bun run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit checkpoint**

Run after validation passes:

```bash
git add README.md
git commit -m "docs: document agent-aware bank routing"
```

---

## Task 6: Live OpenCode Smoke Test After Plugin Restart

**Files:**
- No repository file changes expected

**Subagent dispatch prompt:**

```text
GOAL: Verify the implemented plugin can observe agent metadata and route a review subagent to the mapped bank in a real OpenCode session.
FILES:
- No file changes expected
INSTRUCTIONS:
1. Ask the orchestrator to restart OpenCode with the built plugin loaded.
2. Use a temporary local hindsight.jsonc config with agentProjectBanks mapping for review-* and runtimeProjectBanks alias if the user approves touching local config.
3. Spawn a review-* subagent and call read-only hindsight help/list operations.
4. Inspect plugin logs for agent, projectBankSource, and agentPattern.
CONSTRAINTS:
- Do not expose secrets.
- Do not permanently overwrite user config; make a backup before local config changes and restore it after the smoke test if changed.
VALIDATION:
- Evidence from plugin logs shows review-* agent resolved with projectBankSource=agentProjectBanks and agentPattern=review-*.
STOP: DONE with evidence; NEEDS_CONTEXT if restart/config approval is needed; BLOCKED if logs or restart are unavailable.
```

- [ ] **Step 1: Build plugin**

Run:

```bash
bun run build
```

Expected: exit 0 and `dist/` updated.

- [ ] **Step 2: Restart OpenCode with this plugin version**

Manual action: quit and restart OpenCode so plugin config-time code reloads.

Expected: new session uses the built plugin code.

- [ ] **Step 3: Configure temporary agent mapping**

If user approves local config changes, add this to `~/.config/opencode/hindsight.jsonc` while preserving existing fields:

```jsonc
{
  "agentProjectBanks": {
    "review-*": "proj-opencode-hindsight-review-smoke"
  },
  "runtimeProjectBanks": {
    "smoke-review": "proj-opencode-hindsight-review-smoke"
  }
}
```

Expected: config remains valid JSONC.

- [ ] **Step 4: Spawn a review subagent**

Use a read-only review subagent and ask it to run:

```text
hindsight(mode: "help")
hindsight(mode: "list", scope: "project", limit: 1)
```

Expected: both tool calls succeed or return a normal empty list; neither should return an unknown alias error.

- [ ] **Step 5: Inspect plugin logs**

Inspect the Hindsight plugin log file used by the local setup, commonly `~/.opencode-hindsight.log`.

Expected log evidence contains:

```text
projectBankSource: "agentProjectBanks"
agentPattern: "review-*"
```

- [ ] **Step 6: Commit no repository changes**

Run:

```bash
git status --short
```

Expected: no new repository changes from the smoke test.

---

## Final Validation Checklist

- [ ] `bun test` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run build` passes.
- [ ] README documents agent mapping and runtime aliases.
- [ ] Live smoke test either passes or has a documented blocker requiring OpenCode restart/log access.
- [ ] Git history contains small commits for resolver, tool/chat routing, compaction routing, and docs.

## Self-Review Notes

- Spec coverage: config maps, precedence, exact/glob matching, per-tool alias, chat/tool/compaction routing, docs, tests, and smoke validation are all mapped to tasks.
- Placeholder scan: no unresolved placeholder markers are present.
- Type consistency: plan consistently uses `BankRoutingConfig`, `ResolveBanksInput`, `ResolvedBanks`, `projectBankAlias`, and tool arg `bankAlias`.
