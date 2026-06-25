import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { CONFIG } from "../config.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function getGitEmail(): string | null {
  try {
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    return email || null;
  } catch {
    return null;
  }
}

export function getUserBank(): string {
  // If userBank is explicitly set, use it
  if (CONFIG.userBank) {
    return CONFIG.userBank;
  }

  // Otherwise, auto-generate based on bankPrefix
  const email = getGitEmail();
  if (email) {
    return `${CONFIG.bankPrefix}_user_${sha256(email)}`;
  }
  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  return `${CONFIG.bankPrefix}_user_${sha256(fallback)}`;
}

export function getProjectBank(directory: string): string {
  // If projectBank is explicitly set, use it
  if (CONFIG.projectBank) {
    return CONFIG.projectBank;
  }

  // Otherwise, auto-generate based on bankPrefix
  const projectName = directory.split("/").pop() || "unknown";
  return `p_${projectName}_${sha256(directory)}`;
}

export function getBanks(directory: string): { user: string; project: string } {
  const banks = resolveBanks({ directory });
  return { user: banks.user, project: banks.project };
}

// ---------------------------------------------------------------------------
// Agent-aware bank routing (pure per-call resolver)
// ---------------------------------------------------------------------------

/**
 * Routing configuration shape: the bank maps and explicit project bank that
 * drive resolution. Mirrors the relevant slice of {@link CONFIG}.
 */
export interface BankRoutingConfig {
  /** Per-agent project bank overrides: exact names and glob patterns (`*` wildcard). */
  agentProjectBanks?: Record<string, string>;
  /** Runtime alias map: alias name -> concrete bank id. */
  runtimeProjectBanks?: Record<string, string>;
  /** Explicit project bank from config (acts as a fallback below agent matches). */
  projectBank?: string;
}

/**
 * Input accepted by `resolveBanks`. All fields are explicit so the resolver
 * is deterministic and side-effect free.
 */
export interface ResolveBanksInput {
  /** Absolute project directory. Used for the generated fallback bank name. */
  directory: string;
  /** Agent name to match against `agentProjectBanks` patterns. */
  agent?: string;
  /**
   * Runtime project bank alias name (not a bank id). Resolved against
   * `runtimeProjectBanks`. Throws when the alias is unknown. Runtime alias
   * is supplied only through this field.
   */
  projectBankAlias?: string;
}

/**
 * Options that control resolver behavior without changing input data.
 * `config` and `env` allow deterministic tests without touching globals.
 */
export interface ResolveBanksOptions {
  /**
   * Explicit routing config snapshot. When provided, its
   * `agentProjectBanks`, `runtimeProjectBanks`, and `projectBank` are used
   * instead of the global `CONFIG`. Omit to use the live `CONFIG`.
   */
  config?: BankRoutingConfig;
  /**
   * Explicit env snapshot. When provided, `env.HINDSIGHT_PROJECT_BANK_ID`
   * and `env.HINDSIGHT_BANK_ID` are used instead of `process.env`.
   * Omit to read from `process.env`.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Identifies which source resolved the project bank. Values mirror the
 * resolution precedence chain so routing logs are unambiguous.
 */
export type ProjectBankSource =
  | "env:HINDSIGHT_PROJECT_BANK_ID"
  | "env:HINDSIGHT_BANK_ID"
  | "runtimeProjectBanks"
  | "agentProjectBanks"
  | "config:projectBank"
  | "generated";

/** Result of resolving banks for a single call. */
export interface ResolvedBanks {
  user: string;
  project: string;
  /** Which source produced `project`. */
  projectSource: ProjectBankSource;
  /** Agent name that matched `agentProjectBanks` (exact or glob). */
  agent?: string;
  /** Runtime alias name resolved through `runtimeProjectBanks`. */
  projectBankAlias?: string;
  /** Pattern key in `agentProjectBanks` that matched `agent` (exact name or glob). */
  agentPattern?: string;
}

/**
 * Convert a glob pattern containing only `*` wildcards into an ECMAScript
 * regex source string. `*` becomes `.*`; all other characters are escaped.
 */
function globToRegexSource(pattern: string): string {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") {
      out += ".*";
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return `^${out}$`;
}

/**
 * Match an agent name against a set of bank patterns, preferring exact matches
 * over glob matches. Returns the matched bank id and the pattern key that
 * produced it, or `undefined` when nothing matches.
 */
function matchAgentBank(
  agent: string | undefined,
  agentBanks: Record<string, string>,
): { bank: string; pattern: string } | undefined {
  if (!agent || !agentBanks) return undefined;

  // 1. Exact match wins.
  if (Object.prototype.hasOwnProperty.call(agentBanks, agent)) {
    const bank = agentBanks[agent];
    if (typeof bank === "string" && bank.trim()) {
      return { bank: bank.trim(), pattern: agent };
    }
  }

  // 2. Glob match (`*` is the only wildcard). First matching pattern wins,
  //    but exact matches are already handled above so this only runs when no
  //    exact match exists.
  for (const [pattern, bank] of Object.entries(agentBanks)) {
    if (!pattern.includes("*")) continue;
    if (typeof bank !== "string" || !bank.trim()) continue;
    const re = new RegExp(globToRegexSource(pattern));
    if (re.test(agent)) {
      return { bank: bank.trim(), pattern };
    }
  }

  return undefined;
}

function generatedProjectBank(directory: string): string {
  const projectName = directory.split("/").pop() || "unknown";
  return `p_${projectName}_${sha256(directory)}`;
}

/**
 * Pure per-call bank resolver implementing project bank precedence:
 *
 *   1. `HINDSIGHT_PROJECT_BANK_ID` env var
 *   2. `HINDSIGHT_BANK_ID` env var (legacy fallback)
 *   3. Runtime project bank alias (`projectBankAlias` resolved against
 *      `runtimeProjectBanks`)
 *   4. Exact / glob `agentProjectBanks` match for `agent`
 *   5. `projectBank` from config (explicit fallback)
 *   6. Generated `p_<project>_<hash>` fallback
 *
 * The user bank is always resolved via {@link getUserBank}.
 */
export function resolveBanks(
  input: ResolveBanksInput,
  options: ResolveBanksOptions = {},
): ResolvedBanks {
  const env = options.env ?? process.env;
  const useExplicitConfig = options.config !== undefined;
  const cfgAgentBanks = useExplicitConfig ? (options.config!.agentProjectBanks ?? {}) : CONFIG.agentProjectBanks;
  const cfgRuntimeBanks = useExplicitConfig ? (options.config!.runtimeProjectBanks ?? {}) : CONFIG.runtimeProjectBanks;
  const cfgProjectBank = useExplicitConfig ? options.config!.projectBank : CONFIG.projectBank;

  let project: string | undefined;
  let projectSource: ProjectBankSource | undefined;
  let matchedAgent: string | undefined;
  let matchedAlias: string | undefined;
  let matchedAgentPattern: string | undefined;

  const alias = input.projectBankAlias?.trim() || undefined;
  let runtimeAliasBank: string | undefined;

  if (alias !== undefined) {
    const hasAlias = Object.prototype.hasOwnProperty.call(cfgRuntimeBanks, alias);
    const resolved = hasAlias ? cfgRuntimeBanks[alias] : undefined;
    if (typeof resolved !== "string" || !resolved.trim()) {
      throw new Error(`Unknown runtime project bank alias: ${alias}`);
    }
    runtimeAliasBank = resolved.trim();
  }

  // 1. HINDSIGHT_PROJECT_BANK_ID
  if (project === undefined && env.HINDSIGHT_PROJECT_BANK_ID) {
    project = env.HINDSIGHT_PROJECT_BANK_ID;
    projectSource = "env:HINDSIGHT_PROJECT_BANK_ID";
  }

  // 2. HINDSIGHT_BANK_ID (legacy)
  if (project === undefined && env.HINDSIGHT_BANK_ID) {
    project = env.HINDSIGHT_BANK_ID;
    projectSource = "env:HINDSIGHT_BANK_ID";
  }

  // 3. Runtime project bank alias
  if (project === undefined && alias !== undefined && runtimeAliasBank !== undefined) {
    project = runtimeAliasBank;
    projectSource = "runtimeProjectBanks";
    matchedAlias = alias;
  }

  // 4. Agent exact/glob match
  if (project === undefined) {
    const agentMatch = matchAgentBank(input.agent, cfgAgentBanks);
    if (agentMatch !== undefined) {
      project = agentMatch.bank;
      projectSource = "agentProjectBanks";
      matchedAgent = input.agent;
      matchedAgentPattern = agentMatch.pattern;
    }
  }

  // 5. CONFIG.projectBank / explicit projectBank fallback
  if (project === undefined && cfgProjectBank) {
    project = cfgProjectBank;
    projectSource = "config:projectBank";
  }

  // 6. Generated fallback
  if (project === undefined) {
    project = generatedProjectBank(input.directory);
    projectSource = "generated";
  }

  return {
    user: getUserBank(),
    project,
    projectSource: projectSource!,
    agent: matchedAgent,
    projectBankAlias: matchedAlias,
    agentPattern: matchedAgentPattern,
  };
}
