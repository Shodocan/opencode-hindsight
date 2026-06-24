import { describe, it, expect } from "bun:test";
import { resolveBanks } from "../../src/services/tags";

/**
 * Agent-aware Hindsight project bank routing tests.
 *
 * Exercises `resolveBanks` with `options.env` and `options.config` for
 * fully deterministic tests — no `process.env` mutation.
 */

describe("resolveBanks — agent-aware project bank routing", () => {
  const baseOptions = {
    config: {
      agentProjectBanks: {},
      runtimeProjectBanks: {},
    },
    env: {},
  };

  describe("generated fallback", () => {
    it("produces a generated project bank when no config or env is provided", () => {
      const result = resolveBanks(
        { directory: "/home/user/projects/my-app" },
        { ...baseOptions, env: {} },
      );
      expect(result.project).toMatch(/^p_/);
      expect(result.project).toContain("my-app");
    });

    it("includes a stable hash of the directory in the generated bank", () => {
      const input = { directory: "/home/user/projects/my-app" };
      const result1 = resolveBanks(input, baseOptions);
      const result2 = resolveBanks(input, baseOptions);
      expect(result1.project).toBe(result2.project);
    });
  });

  describe("config projectBank fallback", () => {
    it("uses config.projectBank when no agent overrides or env are present", () => {
      const result = resolveBanks(
        { directory: "/home/user/projects/my-app" },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            projectBank: "my-explicit-bank",
          },
        },
      );
      expect(result.project).toBe("my-explicit-bank");
    });
  });

  describe("exact agent match", () => {
    it("selects the bank for an exact agent name match", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "code-small",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            agentProjectBanks: {
              "code-small": "agent-code-small-bank",
            },
          },
        },
      );
      expect(result.project).toBe("agent-code-small-bank");
    });
  });

  describe("glob agent match", () => {
    it("selects the bank for a glob pattern matching the agent name", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "review-final-gpt",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            agentProjectBanks: {
              "review-*": "review-shared-bank",
            },
          },
        },
      );
      expect(result.project).toBe("review-shared-bank");
    });

    it("supports glob with prefix and suffix", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "typescript-medium",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            agentProjectBanks: {
              "*-medium": "medium-shared-bank",
            },
          },
        },
      );
      expect(result.project).toBe("medium-shared-bank");
    });
  });

  describe("exact-over-glob precedence", () => {
    it("prefers an exact agent match over a glob match", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "review-final-gpt",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            agentProjectBanks: {
              "review-*": "glob-bank",
              "review-final-gpt": "exact-bank",
            },
          },
        },
      );
      expect(result.project).toBe("exact-bank");
    });
  });

  describe("env precedence", () => {
    it("HINDSIGHT_PROJECT_BANK_ID overrides config and agent banks", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "code-small",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            projectBank: "config-bank",
            agentProjectBanks: {
              "code-small": "agent-bank",
            },
          },
          env: {
            HINDSIGHT_PROJECT_BANK_ID: "runtime-override-bank",
          },
        },
      );
      expect(result.project).toBe("runtime-override-bank");
    });
  });

  describe("unknown alias rejection", () => {
    it("throws when an unknown alias is referenced", () => {
      expect(() =>
        resolveBanks(
          {
            directory: "/home/user/projects/my-app",
            projectBankAlias: "unknown-alias",
          },
          {
            ...baseOptions,
            config: {
              ...baseOptions.config,
              runtimeProjectBanks: {
                "known-alias": "known-bank",
              },
            },
          },
        ),
      ).toThrow(/Unknown runtime project bank alias/);
    });
  });

  describe("HINDSIGHT_PROJECT_BANK_ID precedence", () => {
    it("takes priority over HINDSIGHT_BANK_ID, config, and agent banks", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "code-small",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            projectBank: "config-bank",
            agentProjectBanks: {
              "code-small": "agent-bank",
            },
          },
          env: {
            HINDSIGHT_PROJECT_BANK_ID: "primary-env-bank",
            HINDSIGHT_BANK_ID: "legacy-env-bank",
          },
        },
      );
      expect(result.project).toBe("primary-env-bank");
    });
  });

  describe("HINDSIGHT_BANK_ID fallback", () => {
    it("uses HINDSIGHT_BANK_ID when HINDSIGHT_PROJECT_BANK_ID is not set", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            projectBank: "config-bank",
          },
          env: {
            HINDSIGHT_BANK_ID: "legacy-env-bank",
          },
        },
      );
      expect(result.project).toBe("legacy-env-bank");
    });

    it("HINDSIGHT_BANK_ID overrides agent banks but not HINDSIGHT_PROJECT_BANK_ID", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "code-small",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            agentProjectBanks: {
              "code-small": "agent-bank",
            },
          },
          env: {
            HINDSIGHT_BANK_ID: "legacy-env-bank",
          },
        },
      );
      expect(result.project).toBe("legacy-env-bank");
    });
  });

  describe("projectBankAlias", () => {
    it("resolves a runtime alias through runtimeProjectBanks", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          projectBankAlias: "my-alias",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            runtimeProjectBanks: {
              "my-alias": "resolved-bank-from-alias",
            },
          },
        },
      );
      expect(result.project).toBe("resolved-bank-from-alias");
    });

    it("projectBankAlias loses to env vars but beats agent banks", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "code-small",
          projectBankAlias: "my-alias",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            agentProjectBanks: {
              "code-small": "agent-bank",
            },
            runtimeProjectBanks: {
              "my-alias": "alias-bank",
            },
          },
          env: {
            HINDSIGHT_BANK_ID: "legacy-env-bank",
          },
        },
      );
      expect(result.project).toBe("legacy-env-bank");
    });

    it("projectBankAlias beats agent banks and config.projectBank", () => {
      const result = resolveBanks(
        {
          directory: "/home/user/projects/my-app",
          agent: "code-small",
          projectBankAlias: "my-alias",
        },
        {
          ...baseOptions,
          config: {
            ...baseOptions.config,
            projectBank: "config-bank",
            agentProjectBanks: {
              "code-small": "agent-bank",
            },
            runtimeProjectBanks: {
              "my-alias": "alias-bank",
            },
          },
        },
      );
      expect(result.project).toBe("alias-bank");
    });
  });
});
