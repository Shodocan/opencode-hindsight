# Environment Bank References Design

## Goal

Allow Hindsight bank configuration to reference process environment variables for all four configurable bank fields: `userBank`, `projectBank`, `agentProjectBanks`, and `runtimeProjectBanks`.

## Current Behavior

The plugin currently treats configured bank names as literal strings. For example, this configuration maps matching agents to a bank literally named `$OPENCODE_REVIEW_BANK`:

```jsonc
{
  "agentProjectBanks": {
    "review-*": "$OPENCODE_REVIEW_BANK"
  }
}
```

Only `HINDSIGHT_PROJECT_BANK_ID` and `HINDSIGHT_BANK_ID` are read from `process.env` today, and they act as high-precedence global project-bank overrides rather than configurable map values.

## New Behavior

Configured bank values may be full-value environment references:

```jsonc
{
  "userBank": "$OPENCODE_USER_BANK",
  "projectBank": "${OPENCODE_PROJECT_BANK}",
  "agentProjectBanks": {
    "review-*": "$OPENCODE_REVIEW_BANK"
  },
  "runtimeProjectBanks": {
    "reviews": "${OPENCODE_REVIEW_BANK}"
  }
}
```

Supported forms:

- `$VAR_NAME`
- `${VAR_NAME}`

`VAR_NAME` must match `[A-Za-z_][A-Za-z0-9_]*`.

## Resolution Rules

- Env references are expanded at config-load time from the plugin process environment.
- Env references are supported only when the whole configured value is the env reference.
- Partial interpolation is intentionally unsupported. `proj-$OPENCODE_REVIEW_BANK` remains a literal string.
- Expanded values are trimmed.
- Missing or empty env values resolve to undefined:
  - `userBank` and `projectBank` behave as unset.
  - `agentProjectBanks` and `runtimeProjectBanks` entries are dropped.
- Literal bank names continue to work unchanged.
- Existing precedence remains unchanged:
  1. `HINDSIGHT_PROJECT_BANK_ID`
  2. `HINDSIGHT_BANK_ID`
  3. allowlisted `runtimeProjectBanks` alias
  4. matching `agentProjectBanks` exact/glob entry
  5. configured `projectBank`
  6. generated project bank

## Security Boundary

Expansion reads only `process.env` at plugin startup. The model cannot supply env references through the `hindsight` tool. Unknown `bankAlias` values still fail closed, and `agentProjectBanks` matching remains exact plus safe `*` glob only; this feature does not add raw regex support.

## Tests

Add regression coverage for:

- `sanitizeBankValue` expands `$VAR` and `${VAR}`.
- missing/empty env references become undefined.
- partial interpolation stays literal.
- `sanitizeBankMap` expands env refs and drops missing values.
- `CONFIG.userBank` and `CONFIG.projectBank` are sanitized through the same value resolver.
- `resolveBanks` uses env-expanded `projectBank`, `agentProjectBanks`, and `runtimeProjectBanks` when passed an explicit config snapshot.

## Documentation

Document env references in the README configuration section with an example mapping `review-*` to `$OPENCODE_REVIEW_BANK`.
