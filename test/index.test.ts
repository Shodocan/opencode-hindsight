import { beforeEach, describe, expect, mock, test } from "bun:test";

const hindsightCalls: {
  listMemories: Array<{ bank: string; limit?: number }>;
  addMemory: Array<{ content: string; bank: string; metadata: unknown }>;
  getProfile: Array<{ bank: string; query: string }>;
  searchMemories: Array<{ bank: string; query: string }>;
} = {
  listMemories: [],
  addMemory: [],
  getProfile: [],
  searchMemories: [],
};

const logCalls: Array<{ message: string; data: unknown }> = [];

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
    getProfile: async (bank: string, query: string) => {
      hindsightCalls.getProfile.push({ bank, query });
      return { success: true, results: [] };
    },
    searchMemories: async (query: string, bank: string) => {
      hindsightCalls.searchMemories.push({ bank, query });
      return { success: true, results: [] };
    },
  },
}));

mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data });
  },
}));

const { HindsightPlugin, extractAgentName } = await import("../src/index");
const { createCompactionHook } = await import("../src/services/compaction");
const { resolveBanks } = await import("../src/services/tags");
const { CONFIG } = await import("../src/config");

beforeEach(() => {
  hindsightCalls.listMemories = [];
  hindsightCalls.addMemory = [];
  hindsightCalls.getProfile = [];
  hindsightCalls.searchMemories = [];
  logCalls.length = 0;
});

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

  test("rejects bankAlias for help and user-profile operations", async () => {
    const plugin = await HindsightPlugin(pluginContext() as any);

    for (const mode of ["help", "profile"]) {
      const result = await plugin.tool.hindsight.execute(
        { mode, bankAlias: "other-repo" },
        { agent: "review-security", directory: "/tmp/opencode-hindsight-test" } as any
      );
      const parsed = JSON.parse(String(result));
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("bankAlias is not supported");
    }
  });

  test("uses ToolContext.directory for generated project bank routing", async () => {
    const previousProjectBank = process.env.HINDSIGHT_PROJECT_BANK_ID;
    const previousBank = process.env.HINDSIGHT_BANK_ID;

    try {
      delete process.env.HINDSIGHT_PROJECT_BANK_ID;
      delete process.env.HINDSIGHT_BANK_ID;

      const plugin = await HindsightPlugin(pluginContext("/tmp/plugin-root/project-a") as any);
      await plugin.tool.hindsight.execute(
        { mode: "list", scope: "project" },
        {
          agent: "",
          directory: "/tmp/tool-context/project-b",
          sessionID: "session-1",
          messageID: "message-1",
          worktree: "/tmp/tool-context/project-b",
        } as any
      );

      expect(hindsightCalls.listMemories[0]?.bank).toBe(
        resolveBanks({ directory: "/tmp/tool-context/project-b" }).project,
      );
    } finally {
      if (previousProjectBank === undefined) delete process.env.HINDSIGHT_PROJECT_BANK_ID;
      else process.env.HINDSIGHT_PROJECT_BANK_ID = previousProjectBank;

      if (previousBank === undefined) delete process.env.HINDSIGHT_BANK_ID;
      else process.env.HINDSIGHT_BANK_ID = previousBank;
    }
  });

  test("ignores model-supplied agent fields in tool args", async () => {
    const plugin = await HindsightPlugin(pluginContext() as any);

    await plugin.tool.hindsight.execute(
      {
        mode: "list",
        scope: "project",
        agent: "spoofed-agent",
        info: { agent: "nested-spoofed-agent" },
      } as any,
      {
        directory: "/tmp/opencode-hindsight-test",
        sessionID: "session-spoof-test",
        messageID: "message-spoof-test",
        worktree: "/tmp/opencode-hindsight-test",
      } as any
    );

    const routingLog = logCalls.find((entry) => entry.message === "tool.execute: routing");
    expect(routingLog?.data).toMatchObject({ agent: "none" });
  });

  test("does not log raw tool args or chat message previews", async () => {
    const plugin = await HindsightPlugin(pluginContext() as any);
    const sentinel = "review-secret-sentinel";

    await plugin.tool.hindsight.execute(
      { mode: "add", scope: "project", content: sentinel, type: "conversation" },
      { agent: "review-security", directory: "/tmp/opencode-hindsight-test" } as any
    );

    await plugin.tool.hindsight.execute(
      { mode: "search", scope: "project", query: `${sentinel}-query` },
      { agent: "review-security", directory: "/tmp/opencode-hindsight-test" } as any
    );

    await plugin.tool.hindsight.execute(
      { mode: "list", scope: "project", bankAlias: `${sentinel}-alias` },
      { agent: "review-security", directory: "/tmp/opencode-hindsight-test" } as any
    );

    await plugin["chat.message"](
      { sessionID: "session-log-test", agent: "review-security" } as any,
      {
        message: { id: "message-log-test" },
        parts: [
          {
            id: "part-log-test",
            type: "text",
            text: sentinel,
          },
        ],
      } as any
    );

    expect(JSON.stringify(logCalls)).not.toContain(sentinel);
  });

  test("injects memories once per session and resolved project bank", async () => {
    const previousAgentProjectBanks = CONFIG.agentProjectBanks;
    const plugin = await HindsightPlugin(pluginContext() as any);
    const sessionID = "session-agent-switch";
    CONFIG.agentProjectBanks = {
      "agent-a": "agent-a-project-bank",
      "agent-b": "agent-b-project-bank",
    };

    const makeOutput = (id: string, text: string) => ({
      message: { id },
      parts: [
        {
          id: `${id}-part`,
          sessionID,
          messageID: id,
          type: "text",
          text,
        },
      ],
    });

    try {
      await plugin["chat.message"](
        { sessionID, agent: "agent-a" } as any,
        makeOutput("message-a", "first message") as any,
      );

      await plugin["chat.message"](
        { sessionID, agent: "agent-b" } as any,
        makeOutput("message-b", "second message") as any,
      );

      const projectBanks = hindsightCalls.listMemories.map((call) => call.bank);
      expect(projectBanks).toEqual(["agent-a-project-bank", "agent-b-project-bank"]);
    } finally {
      CONFIG.agentProjectBanks = previousAgentProjectBanks;
    }
  });
});

describe("createCompactionHook agent-aware routing", () => {
  function banksForAgent(agent?: string | null) {
    return {
      user: "user-bank",
      project: `${agent ?? "default"}-project-bank`,
      projectSource: agent ? "agentProjectBanks" as const : "generated" as const,
      agent: agent ?? undefined,
      agentPattern: agent ?? undefined,
    };
  }

  test("uses SDK message mode when fetching project memories for compaction", async () => {
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
            mode: "review-security",
            providerID: "test",
            modelID: "model",
            tokens: { input: 50, output: 50, cache: { read: 0 } },
          },
        },
      },
    });

    expect(hindsightCalls.listMemories[0]?.bank).toBe("review-security-project-bank");
  });

  test("uses the updated summary message id and mode before fallback agent when saving summaries", async () => {
    const ctx = pluginContext() as any;
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "old-summary", role: "assistant", summary: true, mode: "old-agent" },
          parts: [
            {
              type: "text",
              text: "This stale summary should not be persisted. ".repeat(3),
            },
          ],
        },
        {
          info: { id: "new-summary", role: "assistant", summary: true, mode: "summary-agent" },
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
            id: "new-summary",
            role: "assistant",
            summary: true,
            finish: true,
            mode: "fallback-agent",
          },
        },
      },
    });

    expect(hindsightCalls.addMemory[0]?.bank).toBe("summary-agent-project-bank");
  });
});
