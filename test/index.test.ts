import { beforeEach, describe, expect, mock, test } from "bun:test";

const hindsightCalls: {
  listMemories: Array<{ bank: string; limit?: number }>;
  addMemory: Array<{ content: string; bank: string; metadata: unknown }>;
} = {
  listMemories: [],
  addMemory: [],
};

mock.module("../src/services/client.js", () => ({
  hindsightClient: {
    listMemories: async (bank: string, limit?: number) => {
      hindsightCalls.listMemories.push({ bank, limit });
      return { success: true, documents: [] };
    },
    addMemory: async (content: string, bank: string, metadata: unknown) => {
      hindsightCalls.addMemory.push({ content, bank, metadata });
      return { success: true };
    },
  },
}));

const { HindsightPlugin, extractAgentName } = await import("../src/index");
const { createCompactionHook } = await import("../src/services/compaction");

function pluginContext(directory = "/tmp/opencode-hindsight-test") {
  return {
    directory,
    client: {
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
      session: {
        summarize: async () => undefined,
        messages: async () => ({ data: [] }),
        promptAsync: async () => undefined,
      },
      tui: {
        showToast: async () => undefined,
      },
    },
  };
}

describe("extractAgentName", () => {
  test("extracts direct and nested agent metadata", () => {
    expect(extractAgentName({ agent: "review-security" })).toBe("review-security");
    expect(extractAgentName({ info: { agentName: "tdd" } })).toBe("tdd");
    expect(extractAgentName({ message: { agent: "builder" } })).toBe("builder");
    expect(extractAgentName({ context: { agentName: "review-final-gpt" } })).toBe("review-final-gpt");
  });

  test("ignores empty, missing, and non-string metadata", () => {
    expect(extractAgentName(undefined, null, { agent: "" }, { info: { agent: 123 } })).toBeUndefined();
  });
});

describe("hindsight tool bankAlias routing errors", () => {
  test("rejects bankAlias for explicitly user-scoped operations", async () => {
    const plugin = await HindsightPlugin(pluginContext() as any);
    const result = await plugin.tool.hindsight.execute(
      { mode: "list", scope: "user", bankAlias: "other-repo" },
      { agent: "review-security" } as any
    );

    expect(JSON.parse(String(result))).toEqual({
      success: false,
      error: "bankAlias is not supported for user-scoped operations",
    });
  });

  test("returns structured JSON when bankAlias is unknown", async () => {
    const previousProjectBank = process.env.HINDSIGHT_PROJECT_BANK_ID;
    const previousBank = process.env.HINDSIGHT_BANK_ID;

    try {
      delete process.env.HINDSIGHT_PROJECT_BANK_ID;
      delete process.env.HINDSIGHT_BANK_ID;

      const plugin = await HindsightPlugin(pluginContext() as any);
      const result = await plugin.tool.hindsight.execute(
        { mode: "list", bankAlias: "missing-alias" },
        { agent: "review-security" } as any
      );

      const parsed = JSON.parse(String(result));
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Bank resolution failed");
      expect(parsed.error).toContain("Unknown runtime project bank alias: missing-alias");
    } finally {
      if (previousProjectBank === undefined) delete process.env.HINDSIGHT_PROJECT_BANK_ID;
      else process.env.HINDSIGHT_PROJECT_BANK_ID = previousProjectBank;

      if (previousBank === undefined) delete process.env.HINDSIGHT_BANK_ID;
      else process.env.HINDSIGHT_BANK_ID = previousBank;
    }
  });
});

describe("createCompactionHook agent-aware routing", () => {
  beforeEach(() => {
    hindsightCalls.listMemories = [];
    hindsightCalls.addMemory = [];
  });

  function banksForAgent(agent?: string | null) {
    return {
      user: "user-bank",
      project: `${agent ?? "default"}-project-bank`,
      projectSource: agent ? "agentProjectBanks" as const : "generated" as const,
      agent: agent ?? undefined,
      agentPattern: agent ?? undefined,
    };
  }

  test("uses event agent when fetching project memories for compaction", async () => {
    const hook = createCompactionHook(
      pluginContext() as any,
      ({ agent } = {}) => banksForAgent(agent),
      { threshold: 0.1, getModelLimit: () => 100 }
    );

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "session-1",
            role: "assistant",
            finish: true,
            agent: "review-security",
            providerID: "test",
            modelID: "model",
            tokens: { input: 50, output: 50, cache: { read: 0 } },
          },
        },
      },
    });

    expect(hindsightCalls.listMemories[0]?.bank).toBe("review-security-project-bank");
  });

  test("uses summary message agent before fallback agent when saving summaries", async () => {
    const ctx = pluginContext() as any;
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "assistant", summary: true, agent: "summary-agent" },
          parts: [
            {
              type: "text",
              text: "This is a long enough summary to be persisted as Hindsight memory. ".repeat(3),
            },
          ],
        },
      ],
    });

    const hook = createCompactionHook(ctx, ({ agent } = {}) => banksForAgent(agent));

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "session-2",
            role: "assistant",
            summary: true,
            finish: true,
            agent: "fallback-agent",
          },
        },
      },
    });

    expect(hindsightCalls.addMemory[0]?.bank).toBe("summary-agent-project-bank");
  });
});
