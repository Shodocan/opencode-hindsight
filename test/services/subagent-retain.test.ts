import { beforeEach, describe, expect, mock, test } from "bun:test";

// Mock hindsightClient
const addMemoryCalls: Array<{ content: string; bank: string; metadata: unknown }> = [];
const logCalls: Array<{ message: string; data: unknown }> = [];

mock.module("../../src/services/client.js", () => ({
  hindsightClient: {
    addMemory: async (content: string, bank: string, metadata: unknown) => {
      addMemoryCalls.push({ content, bank, metadata });
      return { success: true };
    },
  },
}));

mock.module("../../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data });
  },
}));

const { createSubagentRetainHook } = await import("../../src/services/subagent-retain");

function makeContext(directory = "/tmp/test") {
  return {
    directory,
    client: {
      session: {
        messages: async () => ({ data: [] }),
      },
    },
  };
}

function banksForAgent(agent?: string | null) {
  return {
    user: "user-bank",
    project: `${agent ?? "default"}-project-bank`,
    projectSource: agent ? "agentProjectBanks" as const : "generated" as const,
    agent: agent ?? undefined,
    agentPattern: agent ?? undefined,
  };
}

beforeEach(() => {
  addMemoryCalls.length = 0;
  logCalls.length = 0;
});

describe("createSubagentRetainHook", () => {
  test("ignores non-subagent session.deleted (no parentID)", async () => {
    const hook = createSubagentRetainHook(makeContext(), ({ agent } = {}) => banksForAgent(agent));

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(0);
  });

  test("retains subagent last message", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant", agent: "subagent-worker" },
          parts: [{ type: "text", text: "This is the subagent result" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(ctx, ({ agent } = {}) => banksForAgent(agent));

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(1);
    expect(addMemoryCalls[0]!.content).toBe("This is the subagent result");
    expect(addMemoryCalls[0]!.bank).toBe("subagent-worker-project-bank");
  });

  test("dedup by session ID", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant", agent: "subagent-worker" },
          parts: [{ type: "text", text: "Subagent result" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(ctx, ({ agent } = {}) => banksForAgent(agent));

    const event = {
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    };

    await hook.event(event);
    await hook.event(event);

    expect(addMemoryCalls.length).toBe(1);
  });

  test("dedup by content hash (per-bank)", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant", agent: "subagent-worker" },
          parts: [{ type: "text", text: "Identical content" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(ctx, ({ agent } = {}) => banksForAgent(agent));

    // Two different sessions with identical content
    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-2", parentID: "parent-2" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(1);
  });

  test("respects agent allowlist", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant", agent: "review-security" },
          parts: [{ type: "text", text: "Review result" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(
      ctx,
      ({ agent } = {}) => banksForAgent(agent),
      { agents: ["review-*"] },
    );

    // review-security should be retained
    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(1);

    // Now test builder agent — should be skipped
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-2", role: "assistant", agent: "builder" },
          parts: [{ type: "text", text: "Builder result" }],
        },
      ],
    });

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-2", parentID: "parent-2" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(1); // Still 1 — builder was skipped
  });

  test("empty agents = all agents", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant", agent: "any-agent" },
          parts: [{ type: "text", text: "Result" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(
      ctx,
      ({ agent } = {}) => banksForAgent(agent),
      { agents: [] },
    );

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(1);
  });

  test("disabled config skips", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant" },
          parts: [{ type: "text", text: "Result" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(
      ctx,
      ({ agent } = {}) => banksForAgent(agent),
      { enabled: false },
    );

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(0);
  });

  test("messages API failure is graceful", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => {
      throw new Error("Session not found");
    };

    const hook = createSubagentRetainHook(ctx, ({ agent } = {}) => banksForAgent(agent));

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    // No crash, no addMemory call
    expect(addMemoryCalls.length).toBe(0);
  });

  test("cooldown prevents rapid retains", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "assistant", agent: "review-security" },
          parts: [{ type: "text", text: "First result" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(
      ctx,
      ({ agent } = {}) => banksForAgent(agent),
    );

    // First event
    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    // Second event for same agent — different session, different content
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-2", role: "assistant", agent: "review-security" },
          parts: [{ type: "text", text: "Second result" }],
        },
      ],
    });

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-2", parentID: "parent-2" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(1); // Cooldown prevents second
  });

  test("no assistant message skips", async () => {
    const ctx = makeContext();
    ctx.client.session.messages = async () => ({
      data: [
        {
          info: { id: "msg-1", role: "user" },
          parts: [{ type: "text", text: "User message" }],
        },
      ],
    });

    const hook = createSubagentRetainHook(ctx, ({ agent } = {}) => banksForAgent(agent));

    await hook.event({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "session-1", parentID: "parent-1" },
        },
      },
    });

    expect(addMemoryCalls.length).toBe(0);
  });
});
