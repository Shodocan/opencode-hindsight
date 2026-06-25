import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool, type ToolContext } from "@opencode-ai/plugin";

import { hindsightClient } from "./services/client.js";
import { formatContextForPrompt } from "./services/context.js";
import { resolveBanks, type ResolvedBanks } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { createCompactionHook, type CompactionContext } from "./services/compaction.js";

import { isConfigured, CONFIG } from "./config.js";
import { log } from "./services/logger.js";
import type { MemoryScope, MemoryType } from "./types/index.js";
import { createHash } from "node:crypto";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function extractEntities(content: string): Array<{ text: string; type?: string }> {
  // 提取域名、API路径、带标记的关键词
  const entities: Array<{ text: string; type?: string }> = [];

  // 域名: xxx.xxx.xxx 或 https?://xxx.xxx.xxx
  const domainRe = /(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)/g;
  const seen = new Set<string>();
  for (const m of content.matchAll(domainRe)) {
    const d = m[1]?.toLowerCase();
    if (d && !seen.has(d) && d.length < 60) {
      seen.add(d);
      entities.push({ text: d, type: "domain" });
    }
  }

  // API 路径: /path/to/endpoint
  const apiRe = /\/[a-zA-Z0-9._/-]+/g;
  for (const m of content.matchAll(apiRe)) {
    const p = m[0];
    if (p.length > 5 && p.length < 80 && !seen.has(p)) {
      seen.add(p);
      entities.push({ text: p, type: "api_path" });
    }
  }

  return entities.slice(0, 20);
}

const MEMORY_KEYWORD_PATTERN = new RegExp(`\\b(${CONFIG.keywordPatterns.join("|")})\\b`, "i");

const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`hindsight\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for cross-project preferences (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function detectMemoryKeyword(text: string): boolean {
  const textWithoutCode = removeCodeBlocks(text);
  return MEMORY_KEYWORD_PATTERN.test(textWithoutCode);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractAgentName(...sources: unknown[]): string | undefined {
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

export const HindsightPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  const defaultBanks = resolveBanks({ directory });
  const injectedSessions = new Set<string>();
  log("Plugin init", {
    directory,
    defaultBank: defaultBanks.project,
    projectBankSource: defaultBanks.projectSource,
    configured: isConfigured(),
  });

  if (!isConfigured()) {
    log("Plugin disabled - Hindsight baseUrl not configured");
  }

  // Fetch model limits once at plugin init
  const modelLimits = new Map<string, number>();

  (async () => {
    try {
      const response = await ctx.client.provider.list();
      if (response.data?.all) {
        for (const provider of response.data.all) {
          if (provider.models) {
            for (const [modelId, model] of Object.entries(provider.models)) {
              if (model.limit?.context) {
                modelLimits.set(`${provider.id}/${modelId}`, model.limit.context);
              }
            }
          }
        }
      }
      log("Model limits loaded", { count: modelLimits.size });
    } catch (error) {
      log("Failed to fetch model limits", { error: String(error) });
    }
  })();

  const getModelLimit = (providerID: string, modelID: string): number | undefined => {
    return modelLimits.get(`${providerID}/${modelID}`);
  };

  const compactionHook = isConfigured() && ctx.client
    ? createCompactionHook(
        ctx as CompactionContext,
        ({ agent } = {}) => resolveBanks({ directory, agent: agent ?? undefined }),
        {
          threshold: CONFIG.compactionThreshold,
          getModelLimit,
        }
      )
    : null;

  return {
    "chat.message": async (input, output) => {
      if (!isConfigured()) return;

      const start = Date.now();

      const agent = extractAgentName(input, output, output?.message);
      const banks = resolveBanks({ directory, agent });
      log("chat.message: routing", {
        agent: agent ?? "none",
        projectBankSource: banks.projectSource,
        agentPattern: banks.agentPattern ?? "none",
      });

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );

        if (textParts.length === 0) {
          log("chat.message: no text parts found");
          return;
        }

        const userMessage = textParts.map((p) => p.text).join("\n");

        if (!userMessage.trim()) {
          log("chat.message: empty message, skipping");
          return;
        }

        log("chat.message: processing", {
          messageLength: userMessage.length,
          partsCount: output.parts.length,
          textPartsCount: textParts.length,
        });

        if (detectMemoryKeyword(userMessage)) {
          log("chat.message: memory keyword detected");
          const nudgePart: Part = {
            id: `prt_hindsight-nudge-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: MEMORY_NUDGE_MESSAGE,
            synthetic: true,
          };
          output.parts.push(nudgePart);
        }

        const isFirstMessage = !injectedSessions.has(input.sessionID);

        if (isFirstMessage) {
          injectedSessions.add(input.sessionID);

          const [profileResult, userMemoriesResult, projectMemoriesListResult] = await Promise.all([
            hindsightClient.getProfile(banks.user, userMessage),
            hindsightClient.searchMemories(userMessage, banks.user),
            hindsightClient.listMemories(banks.project, CONFIG.maxProjectMemories),
          ]);

          const profile = profileResult.success ? { results: profileResult.results } : null;
          const userMemories = userMemoriesResult.success ? userMemoriesResult : { results: [] };
          const projectMemoriesList = projectMemoriesListResult.success ? projectMemoriesListResult : { documents: [] };

          const projectMemories = {
            results: (projectMemoriesList.documents || []).map((m: any) => ({
              id: m.id,
              text: m.text || m.content || m.summary || "",
              similarity: 1,
              metadata: m.metadata,
            })),
            total: projectMemoriesList.documents?.length || 0,
            timing: 0,
          };

          const memoryContext = formatContextForPrompt(
            profile,
            userMemories,
            projectMemories
          );

          if (memoryContext) {
            const contextPart: Part = {
              id: `prt_hindsight-context-${Date.now()}`,
              sessionID: input.sessionID,
              messageID: output.message.id,
              type: "text",
              text: memoryContext,
              synthetic: true,
            };

            output.parts.unshift(contextPart);

            const duration = Date.now() - start;
            log("chat.message: context injected", {
              duration,
              contextLength: memoryContext.length,
            });
          }
        }

      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
      }
    },

    tool: {
      hindsight: tool({
        description:
          "Manage and query the Hindsight persistent memory system. Always call this tool as `hindsight(mode:\"search/add/profile/list/forget\", ...)`, for example: hindsight(mode:\"search\", query:\"keyword\") or hindsight(mode:\"add\", content:\"memory\"). Do NOT use hindsight_search, hindsight_list, or similar auto-generated names.",
        args: {
          mode: tool.schema
            .enum(["add", "search", "profile", "list", "forget", "help"])
            .optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          type: tool.schema
            .enum([
              "project-config",
              "architecture",
              "error-solution",
              "preference",
              "learned-pattern",
              "conversation",
            ])
            .optional(),
          scope: tool.schema.enum(["user", "project"]).optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          bankAlias: tool.schema.string().optional(),
        },
        async execute(
          args: {
            mode?: string;
            content?: string;
            query?: string;
            type?: MemoryType;
            scope?: MemoryScope;
            memoryId?: string;
            limit?: number;
            bankAlias?: string;
          },
          context?: ToolContext
        ) {
          const mode = args.mode || "help";
          log("tool.execute: start", {
            mode,
            baseUrl: CONFIG.baseUrl,
            configured: isConfigured(),
            scope: args.scope,
            type: args.type,
            hasContent: typeof args.content === "string" && args.content.length > 0,
            contentLength: typeof args.content === "string" ? args.content.length : 0,
            hasQuery: typeof args.query === "string" && args.query.length > 0,
            queryLength: typeof args.query === "string" ? args.query.length : 0,
            hasMemoryId: typeof args.memoryId === "string" && args.memoryId.length > 0,
            limit: args.limit,
            bankAlias: args.bankAlias,
          });

          if (!isConfigured()) {
            return JSON.stringify({
              success: false,
              error:
                "Hindsight baseUrl not configured. Set baseUrl in config or environment to use Hindsight.",
            });
          }

          if (args.bankAlias && args.scope === "user") {
            return JSON.stringify({
              success: false,
              error: "bankAlias is not supported for user-scoped operations",
            });
          }

          const callDirectory = context?.directory ?? directory;
          const agent = extractAgentName(context);
          let banks: ResolvedBanks;
          try {
            banks = resolveBanks({ directory: callDirectory, agent, projectBankAlias: args.bankAlias });
          } catch (err) {
            return JSON.stringify({
              success: false,
              error: `Bank resolution failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }

          log("tool.execute: routing", {
            mode,
            agent: agent ?? "none",
            bankAlias: args.bankAlias,
            projectBankSource: banks.projectSource,
            agentPattern: banks.agentPattern ?? "none",
          });

          try {
            switch (mode) {
              case "help": {
                return JSON.stringify({
                  success: true,
                  message: "Hindsight Usage Guide",
                  commands: [
                    { command: "add", description: "Store a new memory", args: ["content", "type?", "scope?"] },
                    { command: "search", description: "Search memories", args: ["query", "scope?"] },
                    { command: "profile", description: "View user profile", args: ["query?"] },
                    { command: "list", description: "List recent memories", args: ["scope?", "limit?"] },
                    { command: "forget", description: "Remove a memory", args: ["memoryId", "scope?"] },
                  ],
                  scopes: { user: "Cross-project preferences and knowledge", project: "Project-specific knowledge (default)" },
                  types: ["project-config", "architecture", "error-solution", "preference", "learned-pattern", "conversation"],
                  bankAliases: Object.keys(CONFIG.runtimeProjectBanks),
                });
              }

              case "add": {
                if (!args.content) {
                  return JSON.stringify({ success: false, error: "content parameter is required" });
                }
                const sanitizedContent = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content)) {
                  return JSON.stringify({ success: false, error: "Cannot store fully private content" });
                }
                const scope = args.scope || "project";
                const bank = scope === "user" ? banks.user : banks.project;
                const memType = args.type || "learned-pattern";

                // 架构类: documentId 覆盖更新 + verbatim 标签避免压缩
                const isArchitecture = memType === "architecture";
                const docOptions = isArchitecture ? {
                  documentId: `arch_${hashContent(sanitizedContent)}`,
                  updateMode: 'replace' as const,
                  tags: ["verbatim", "architecture"],
                  entities: extractEntities(sanitizedContent),
                } : {};

                const result = await hindsightClient.addMemory(
                  sanitizedContent, bank,
                  { type: memType, tool: "hindsight" },
                  docOptions
                );
                if (!result.success) {
                  return JSON.stringify({ success: false, error: result.error || "Failed to add memory" });
                }
                return JSON.stringify({
                  success: true, message: `Memory added to ${scope} scope`,
                  operationId: result.operationId, itemsCount: result.itemsCount,
                  scope, type: args.type, replaced: isArchitecture,
                });
              }

              case "search": {
                if (!args.query) {
                  return JSON.stringify({ success: false, error: "query parameter is required" });
                }
                const scope = args.scope;
                if (scope === "user") {
                  const result = await hindsightClient.searchMemories(args.query, banks.user);
                  if (!result.success) return JSON.stringify({ success: false, error: result.error || "Failed to search memories" });
                  return formatSearchResults(args.query, scope, result, args.limit);
                }
                if (scope === "project") {
                  const result = await hindsightClient.searchMemories(args.query, banks.project);
                  if (!result.success) return JSON.stringify({ success: false, error: result.error || "Failed to search memories" });
                  return formatSearchResults(args.query, scope, result, args.limit);
                }
                const [userResult, projectResult] = await Promise.all([
                  hindsightClient.searchMemories(args.query, banks.user),
                  hindsightClient.searchMemories(args.query, banks.project),
                ]);
                if (!userResult.success || !projectResult.success) {
                  return JSON.stringify({ success: false, error: userResult.error || projectResult.error || "Failed to search memories" });
                }
                const combined = [
                  ...(userResult.results || []).map((r) => ({ ...r, scope: "user" as const })),
                  ...(projectResult.results || []).map((r) => ({ ...r, scope: "project" as const })),
                ].sort((a, b) => ((b as any).similarity ?? 0) - ((a as any).similarity ?? 0));
                return JSON.stringify({
                  success: true, query: args.query, count: combined.length,
                  results: combined.slice(0, args.limit || 10).map((r) => ({
                    id: r.id, content: r.text || (r as any).memory || "",
                    similarity: Math.round(((r as any).similarity ?? 0) * 100), scope: r.scope,
                  })),
                });
              }

              case "profile": {
                const result = await hindsightClient.getProfile(banks.user, args.query);
                if (!result.success) return JSON.stringify({ success: false, error: result.error || "Failed to fetch profile" });
                return JSON.stringify({
                  success: true,
                  profile: { static: result.results?.slice(0, CONFIG.maxProfileItems) || [] },
                });
              }

              case "list": {
                const scope = args.scope || "project";
                const limit = args.limit || 20;
                const bank = scope === "user" ? banks.user : banks.project;
                const result = await hindsightClient.listMemories(bank, limit);
                if (!result.success) return JSON.stringify({ success: false, error: result.error || "Failed to list memories" });
                const documents = result.documents || [];
                return JSON.stringify({
                  success: true, scope, count: documents.length,
                  memories: documents.map((m: any) => ({
                    id: m.id, content: m.text || m.content || m.summary,
                    createdAt: m.date || m.createdAt,
                    metadata: { type: m.type, context: m.context, entities: m.entities },
                  })),
                });
              }

              case "forget": {
                if (!args.memoryId) return JSON.stringify({ success: false, error: "memoryId parameter is required" });
                const scope = args.scope || "project";
                const bank = scope === "user" ? banks.user : banks.project;
                const result = await hindsightClient.deleteMemory(bank, args.memoryId);
                if (!result.success) return JSON.stringify({ success: false, error: result.error || "Failed to delete memory" });
                return JSON.stringify({
                  success: true,
                  message: `Memory ${args.memoryId} observations cleared in ${scope} scope`,
                });
              }

              default:
                return JSON.stringify({ success: false, error: `Unknown mode: ${mode}` });
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log("tool.execute: EXCEPTION", { mode, error: msg, stack: error instanceof Error ? error.stack : undefined });
            return JSON.stringify({ success: false, error: msg });
          }
        },
      }),
    },

    event: async (input: { event: { type: string; properties?: unknown } }) => {
      if (compactionHook) {
        await compactionHook.event(input);
      }
    },
  };
};

function formatSearchResults(
  query: string,
  scope: string | undefined,
  results: { results?: Array<{ id: string; text?: string; similarity?: number }> },
  limit?: number
): string {
  const memoryResults = results.results || [];
  return JSON.stringify({
    success: true,
    query,
    scope,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((r) => ({
      id: r.id,
      content: r.text || "",
      similarity: Math.round((r.similarity ?? 0) * 100),
    })),
  });
}
