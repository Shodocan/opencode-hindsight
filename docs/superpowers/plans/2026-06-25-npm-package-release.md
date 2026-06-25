# npm Package Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and validate the public npm package `@shodocan/opencode-hindsight`, open a PR for remote testing, then publish and install after credentials are confirmed.

**Architecture:** This is a packaging and documentation change. Runtime plugin behavior remains unchanged; package metadata and README install paths are updated so npm users can install the OpenCode plugin and understand that Vectorize Hindsight remains the backend service.

**Tech Stack:** TypeScript, Bun, npm package metadata, GitHub PR workflow, Infisical CLI for secret lookup if token publishing is needed.

---

### Task 1: Package Metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package identity**

Set `name` to `@shodocan/opencode-hindsight`, update repository/bugs/homepage to the Shodocan GitHub repo, and add `publishConfig` with public npm registry/access.

- [ ] **Step 2: Preserve plugin entry points**

Keep `main`, `types`, `bin`, `opencode`, dependencies, and build scripts compatible with the existing plugin.

- [ ] **Step 3: Validate package metadata**

Run: `bun run typecheck`
Expected: exit 0.

### Task 2: README Release Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add package identity notice**

Add a top-level note that this is the Shodocan OpenCode plugin package, not vanilla Vectorize Hindsight.

- [ ] **Step 2: Add npm install instructions**

Document `npm install -g @shodocan/opencode-hindsight` and OpenCode plugin configuration using the package name.

- [ ] **Step 3: Keep local development install instructions**

Retain the existing `git clone` / `bun install` / `file://` workflow as the development path.

- [ ] **Step 4: Summarize Shodocan changes**

List agent-aware project bank routing, runtime bank aliases, trusted tool-context routing, compaction routing, privacy-safe logging, and offline/Chinese deployment notes.

### Task 3: Build and Pack Validation

**Files:**
- No source edits expected unless validation reveals a packaging blocker.

- [ ] **Step 1: Run tests**

Run: `env -u HINDSIGHT_PROJECT_BANK_ID -u HINDSIGHT_BANK_ID bun test`
Expected: 40 pass, 0 fail.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/cli.js`, and `dist/cli.d.ts` generated.

- [ ] **Step 4: Inspect npm pack contents**

Run: `npm pack --dry-run --json`
Expected: tarball includes package metadata, README, and `dist` artifacts; no secrets or unrelated local tooling directories.

### Task 4: PR and Publish Path

**Files:**
- No additional source edits expected.

- [ ] **Step 1: Commit release prep**

Commit package metadata, README, spec, and plan.

- [ ] **Step 2: Push and open PR**

Open a PR from `release/npm-package` to `main` so remote testing can inspect the package preparation.

- [ ] **Step 3: Publish only after PR path is validated**

Use Infisical CLI to locate npm credentials if direct token publishing is required. Keep credentials out of logs and files. Publish with `npm publish --access public --registry https://registry.npmjs.org/`.

- [ ] **Step 4: Install published package locally**

Run an install test using the published package name and report exact commands for OpenCode configuration.
