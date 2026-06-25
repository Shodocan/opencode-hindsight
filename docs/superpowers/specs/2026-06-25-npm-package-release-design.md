# npm Package Release Design

## Goal

Publish this OpenCode plugin as the public npm package `@shodocan/opencode-hindsight`, then install it locally so it can be tested as a normal package instead of only through a `file://` checkout.

## Package Identity

- Package name: `@shodocan/opencode-hindsight`
- Initial public version: `1.0.0`
- Access: public
- Repository: `https://github.com/Shodocan/opencode-hindsight`
- This package is an OpenCode plugin that uses Vectorize Hindsight as its backend. It is not vanilla Vectorize Hindsight and does not replace the Hindsight server.

## Documentation Requirements

The README must clearly explain:

- Users still need to deploy the Hindsight server separately.
- This package is the OpenCode plugin/integration layer.
- Shodocan-specific changes include agent-aware project bank routing, runtime bank aliases, trusted OpenCode tool-context routing, compaction memory routing, and privacy-safe logging.
- npm install path for normal users.
- local source install path for development.

## Publishing Requirements

- Use npm metadata that supports public scoped package publishing.
- Include `dist`, `README.md`, `LICENSE` if present, and package metadata in the npm tarball.
- Verify package contents with `npm pack --dry-run --json` before publishing.
- Use Infisical only to obtain the npm credential if token publishing is required. Do not print tokens or place them in source-controlled files.
- Prefer PR-first flow before publish so remote testing can inspect metadata and docs.

## Validation Requirements

- `bun test`
- `bun run typecheck`
- `bun run build`
- `npm pack --dry-run --json`
- After publishing, `npm install -g @shodocan/opencode-hindsight` or equivalent local install test.

## Scope Boundaries

- Do not change OpenCode runtime behavior in this release prep unless packaging validation reveals a package-install blocker.
- Do not change Hindsight server deployment behavior.
- Do not commit npm credentials or generated secret files.
