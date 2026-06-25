import { describe, it, expect } from "bun:test";
import { getBanks, resolveBanks } from "../../src/services/tags";

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

    it("reports projectSource 'generated' with no agent metadata", () => {
      const result = resolveBanks(
        { directory: "/home/user/projects/my-app" },
        baseOptions,
      );
      expect(result.projectSource).toBe("generated");
      expect(result.agent).toBeUndefined();
      expect(result.agentPattern).toBeUndefined();
      expect(result.projectBankAlias).toBeUndefined();
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

    it("reports projectSource 'config:projectBank' with no agent metadata", () => {
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
      expect(result.projectSource).toBe("config:projectBank");
      expect(result.agent).toBeUndefined();
      expect(result.agentPattern).toBeUndefined();
      expect(result.projectBankAlias).toBeUndefined();
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

    it("reports projectSource 'agentProjectBanks', agent, and agentPattern for exact match", () => {
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
      expect(result.projectSource).toBe("agentProjectBanks");
      expect(result.agent).toBe("code-small");
      expect(result.agentPattern).toBe("code-small");
      expect(result.projectBankAlias).toBeUndefined();
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

    it("reports projectSource 'agentProjectBanks', agent, and glob agentPattern", () => {
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
      expect(result.projectSource).toBe("agentProjectBanks");
      expect(result.agent).toBe("review-final-gpt");
      expect(result.agentPattern).toBe("review-*");
      expect(result.projectBankAlias).toBeUndefined();
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

    it("reports projectSource 'env:HINDSIGHT_PROJECT_BANK_ID' with no agent metadata", () => {
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
      expect(result.projectSource).toBe("env:HINDSIGHT_PROJECT_BANK_ID");
      expect(result.agent).toBeUndefined();
      expect(result.agentPattern).toBeUndefined();
      expect(result.projectBankAlias).toBeUndefined();
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

    it("throws for unknown aliases before applying env project bank overrides", () => {
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
            env: {
              HINDSIGHT_PROJECT_BANK_ID: "env-bank",
            },
          },
        ),
      ).toThrow(/Unknown runtime project bank alias: unknown-alias/);
    });

    it("rejects Object prototype property names as runtime aliases", () => {
      for (const projectBankAlias of ["toString", "constructor", "__proto__"]) {
        expect(() =>
          resolveBanks(
            {
              directory: "/home/user/projects/my-app",
              projectBankAlias,
            },
            {
              ...baseOptions,
              config: {
                ...baseOptions.config,
                runtimeProjectBanks: {},
              },
            },
          ),
        ).toThrow(new RegExp(`Unknown runtime project bank alias: ${projectBankAlias}`));
      }
    });
  });

  describe("legacy getBanks wrapper", () => {
    it("matches resolveBanks generated fallback when env vars are unset", () => {
      const previousProjectBank = process.env.HINDSIGHT_PROJECT_BANK_ID;
      const previousBank = process.env.HINDSIGHT_BANK_ID;

      try {
        delete process.env.HINDSIGHT_PROJECT_BANK_ID;
        delete process.env.HINDSIGHT_BANK_ID;

        const directory = "/home/user/projects/my-app";
        expect(getBanks(directory)).toEqual({
          user: resolveBanks({ directory }).user,
          project: resolveBanks({ directory }).project,
        });
      } finally {
        if (previousProjectBank === undefined) delete process.env.HINDSIGHT_PROJECT_BANK_ID;
        else process.env.HINDSIGHT_PROJECT_BANK_ID = previousProjectBank;

        if (previousBank === undefined) delete process.env.HINDSIGHT_BANK_ID;
        else process.env.HINDSIGHT_BANK_ID = previousBank;
      }
    });

    it("matches resolveBanks project selection under env precedence", () => {
      const previousProjectBank = process.env.HINDSIGHT_PROJECT_BANK_ID;
      const previousBank = process.env.HINDSIGHT_BANK_ID;

      try {
        process.env.HINDSIGHT_PROJECT_BANK_ID = "env-bank";
        delete process.env.HINDSIGHT_BANK_ID;

        const directory = "/home/user/projects/my-app";
        expect(getBanks(directory)).toEqual({
          user: resolveBanks({ directory }).user,
          project: resolveBanks({ directory }).project,
        });
      } finally {
        if (previousProjectBank === undefined) delete process.env.HINDSIGHT_PROJECT_BANK_ID;
        else process.env.HINDSIGHT_PROJECT_BANK_ID = previousProjectBank;

        if (previousBank === undefined) delete process.env.HINDSIGHT_BANK_ID;
        else process.env.HINDSIGHT_BANK_ID = previousBank;
      }
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

    it("reports projectSource 'runtimeProjectBanks' and projectBankAlias for alias match", () => {
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
      expect(result.projectSource).toBe("runtimeProjectBanks");
      expect(result.projectBankAlias).toBe("my-alias");
      expect(result.agent).toBeUndefined();
      expect(result.agentPattern).toBeUndefined();
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
