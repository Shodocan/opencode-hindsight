# Environment Bank References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support full-value environment variable references for `userBank`, `projectBank`, `agentProjectBanks`, and `runtimeProjectBanks` without changing existing bank precedence or agent glob behavior.

**Architecture:** Add a small config-layer sanitizer that expands only whole-value `$VAR` and `${VAR}` references from `process.env`, trims results, and treats missing/empty env values as unset. Keep the resolver pure and deterministic by continuing to accept explicit config snapshots in tests.

**Tech Stack:** TypeScript, Bun test runner, OpenCode plugin config, npm package release flow.

---

## Constraints

- Use TDD: write failing tests first and verify RED before production code.
- One write-capable subagent for the implementation task.
- Use `subagent-task-harness` for dispatch and result checking.
- Keep runtime behavior unchanged except bank config env-reference expansion.
- Do not add raw regex support for `agentProjectBanks`.
- Do not allow model/tool-call input to provide env var names.

## Task 1: Config Env Reference Expansion

**Files:**
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`
- Modify: `test/services/tags.test.ts`
- Modify: `README.md`

**Subagent dispatch prompt:**

```text
GOAL: Implement full-value environment variable references for userBank, projectBank, agentProjectBanks, and runtimeProjectBanks.
FILES:
- Modify: src/config.ts
- Modify: test/config.test.ts
- Modify: test/services/tags.test.ts
- Modify: README.md
INSTRUCTIONS:
1. Add failing tests before production code.
2. In test/config.test.ts, cover sanitizeBankValue and sanitizeBankMap behavior for $VAR, ${VAR}, missing env, empty env, literal values, partial interpolation, and array rejection.
3. In test/services/tags.test.ts, cover resolveBanks with explicit config snapshots containing already-expanded userBank/projectBank/agentProjectBanks/runtimeProjectBanks values.
4. In src/config.ts, export a sanitizeBankValue helper and update sanitizeBankMap, CONFIG.userBank, and CONFIG.projectBank to use it.
5. Update README.md configuration docs with a short env-reference example.
CONSTRAINTS:
- Stay within the declared file touch set.
- Support only full-value $VAR and ${VAR}; do not implement partial interpolation.
- Missing or empty env values must become undefined/dropped, never literal $VAR bank names.
- Do not change existing HINDSIGHT_PROJECT_BANK_ID/HINDSIGHT_BANK_ID precedence.
VALIDATION:
- env -u HINDSIGHT_PROJECT_BANK_ID -u HINDSIGHT_BANK_ID bun test
- bun run typecheck
- bun run build
STOP: DONE when validation passes; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Add failing tests**

Add tests like:

```ts
import { sanitizeBankMap, sanitizeBankValue } from "../src/config";

test("expands full-value env refs for bank values", () => {
  const env = { OPENCODE_REVIEW_BANK: " proj-review " };
  expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK", env)).toBe("proj-review");
  expect(sanitizeBankValue("${OPENCODE_REVIEW_BANK}", env)).toBe("proj-review");
});

test("treats missing and empty env refs as unset", () => {
  expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK", {})).toBeUndefined();
  expect(sanitizeBankValue("$OPENCODE_REVIEW_BANK", { OPENCODE_REVIEW_BANK: "  " })).toBeUndefined();
});

test("does not partially interpolate bank values", () => {
  expect(sanitizeBankValue("proj-$OPENCODE_REVIEW_BANK", { OPENCODE_REVIEW_BANK: "review" })).toBe("proj-$OPENCODE_REVIEW_BANK");
});

test("expands env refs in bank maps and drops missing refs", () => {
  expect(
    sanitizeBankMap(
      {
        "review-*": "$OPENCODE_REVIEW_BANK",
        missing: "$MISSING_BANK",
        literal: "proj-literal",
      },
      { OPENCODE_REVIEW_BANK: "proj-review" },
    ),
  ).toEqual({
    "review-*": "proj-review",
    literal: "proj-literal",
  });
});
```

In `test/services/tags.test.ts`, add resolver tests that pass explicit config snapshots using values returned by `sanitizeBankValue`/`sanitizeBankMap`, then assert `review-*` agents route to `proj-review`, runtime alias `reviews` routes to `proj-review`, and project fallback uses `proj-project`.

- [ ] **Step 2: Verify RED**

Run:

```bash
bun test test/config.test.ts test/services/tags.test.ts
```

Expected: FAIL because `sanitizeBankValue` is not exported and env refs are not expanded.

- [ ] **Step 3: Implement config sanitizer**

Add to `src/config.ts`:

```ts
const ENV_REF_RE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

export function sanitizeBankValue(
  value: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(ENV_REF_RE);
  if (!match) return trimmed;
  const envName = match[1] ?? match[2];
  const envValue = env[envName]?.trim();
  return envValue || undefined;
}

export function sanitizeBankMap(
  map: Record<string, string> | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    const cleanKey = key.trim();
    const cleanValue = sanitizeBankValue(value, env);
    if (cleanKey && cleanValue) out[cleanKey] = cleanValue;
  }
  return out;
}
```

Update `CONFIG`:

```ts
userBank: sanitizeBankValue(fileConfig.userBank),
projectBank: sanitizeBankValue(fileConfig.projectBank),
agentProjectBanks: sanitizeBankMap(fileConfig.agentProjectBanks),
runtimeProjectBanks: sanitizeBankMap(fileConfig.runtimeProjectBanks),
```

- [ ] **Step 4: Update README**

In the configuration section, add:

```jsonc
{
  "userBank": "$OPENCODE_USER_BANK",
  "projectBank": "$OPENCODE_PROJECT_BANK",
  "agentProjectBanks": {
    "review-*": "$OPENCODE_REVIEW_BANK"
  },
  "runtimeProjectBanks": {
    "reviews": "${OPENCODE_REVIEW_BANK}"
  }
}
```

Explain that only full-value `$VAR` and `${VAR}` are expanded, missing/empty env vars are treated as unset, and partial interpolation is not supported.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
env -u HINDSIGHT_PROJECT_BANK_ID -u HINDSIGHT_BANK_ID bun test
bun run typecheck
bun run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit checkpoint**

Run after validation passes:

```bash
git add src/config.ts test/config.test.ts test/services/tags.test.ts README.md
git commit -m "feat: expand env bank references"
```

## Task 2: Review, PR, and Patch Release

**Files:**
- Modify: `package.json` if version bump is needed for publish
- Modify: generated lockfile if package manager changes it during version bump

**Subagent dispatch prompt:**

```text
GOAL: Review env bank reference implementation and prepare patch release metadata only if needed.
FILES:
- Modify: package.json
INSTRUCTIONS:
1. Inspect implementation diff for security, config, and compatibility issues.
2. If publishing to npm is requested after merge, bump patch version from 1.0.0 to 1.0.1.
3. Do not change runtime source behavior in this task.
CONSTRAINTS:
- Stay within package.json unless a lockfile exists and requires synchronized version metadata.
- Do not publish from a branch before PR merge.
VALIDATION:
- env -u HINDSIGHT_PROJECT_BANK_ID -u HINDSIGHT_BANK_ID bun test
- bun run typecheck
- bun run build
- npm pack --dry-run --json
STOP: DONE when validation passes; NEEDS_CONTEXT for ambiguity; BLOCKED for unsafe/missing validation.
```

- [ ] **Step 1: Run review agents**

Dispatch security/config/doc review agents over the feature diff. Fix any Critical/Important issues before PR.

- [ ] **Step 2: Push and open PR**

Run:

```bash
git push -u origin feat/env-bank-refs
gh pr create --repo Shodocan/opencode-hindsight --base main --head feat/env-bank-refs --title "feat: expand env bank references" --body "## Summary
- Expand full-value bank config references like \`$OPENCODE_REVIEW_BANK\` and \`${OPENCODE_REVIEW_BANK}\`.
- Apply expansion to \`userBank\`, \`projectBank\`, \`agentProjectBanks\`, and \`runtimeProjectBanks\`.
- Document env-backed bank routing for review agents.

## Validation
- \`env -u HINDSIGHT_PROJECT_BANK_ID -u HINDSIGHT_BANK_ID bun test\`
- \`bun run typecheck\`
- \`bun run build\`"
```

- [ ] **Step 3: Monitor PR**

Run PR monitor once and handle requested changes through fresh subagents.

- [ ] **Step 4: Publish patch after merge if requested**

After PR merge, sync `main`, bump to `1.0.1` if not already done, validate, publish with Infisical `NPM_ACCESS_TOKEN`, and install from npm.
