import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILES = [
  join(CONFIG_DIR, "hindsight.jsonc"),
  join(CONFIG_DIR, "hindsight.json"),
];

interface HindsightConfig {
  baseUrl?: string;
  similarityThreshold?: number;
  maxMemories?: number;
  maxProjectMemories?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  bankPrefix?: string;
  userBank?: string;
  projectBank?: string;
  maxTokens?: number;
  budget?: 'low' | 'mid' | 'high';
  keywordPatterns?: string[];
  compactionThreshold?: number;
  agentProjectBanks?: Record<string, string>;
  runtimeProjectBanks?: Record<string, string>;
}

const DEFAULT_KEYWORD_PATTERNS = [
  "remember",
  "memorize",
  "save\\s+this",
  "note\\s+this",
  "keep\\s+in\\s+mind",
  "don'?t\\s+forget",
  "learn\\s+this",
  "store\\s+this",
  "record\\s+this",
  "make\\s+a\\s+note",
  "take\\s+note",
  "jot\\s+down",
  "commit\\s+to\\s+memory",
  "remember\\s+that",
  "never\\s+forget",
  "always\\s+remember",
  "记住",
  "记下来",
  "记录.*(一下|下来|API|接口|域名|汇总)",
  "别忘了",
  "下次注意",
  "备忘",
  "存下来",
];

const DEFAULTS: Required<Omit<HindsightConfig, "userBank" | "projectBank" | "baseUrl" | "agentProjectBanks" | "runtimeProjectBanks">> = {
  similarityThreshold: 0.6,
  maxMemories: 5,
  maxProjectMemories: 20,
  maxProfileItems: 5,
  injectProfile: true,
  bankPrefix: "opencode",
  maxTokens: 4096,
  budget: 'mid',
  keywordPatterns: [],
  compactionThreshold: 0.80,
};

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function validateCompactionThreshold(value: number | undefined): number {
  if (value === undefined || typeof value !== 'number' || isNaN(value)) {
    return DEFAULTS.compactionThreshold;
  }
  if (value <= 0 || value > 1) return DEFAULTS.compactionThreshold;
  return value;
}

function loadConfig(): HindsightConfig {
  for (const path of CONFIG_FILES) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as HindsightConfig;
      } catch {
        // Invalid config, use defaults
      }
    }
  }
  return {};
}

const fileConfig = loadConfig();

const ENV_REF_RE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

function getBaseUrl(): string {
  // Priority: env var > config file > default
  if (process.env.HINDSIGHT_BASE_URL) return process.env.HINDSIGHT_BASE_URL;
  if (fileConfig.baseUrl) return fileConfig.baseUrl;
  return 'http://localhost:8888';
}

/**
 * Sanitize one configured bank value. Full-value environment references of
 * the form `$VAR` and `${VAR}` are expanded from the plugin process env.
 * Partial interpolation is intentionally unsupported and remains literal.
 */
export function sanitizeBankValue(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(ENV_REF_RE);
  if (!match) return trimmed;

  const envName = match[1] ?? match[2];
  if (!envName) return undefined;
  const envValue = env[envName]?.trim();
  return envValue || undefined;
}

/**
 * Sanitize a bank-name map from config: reject arrays, drop entries with
 * non-string keys/values, strip leading/trailing whitespace, and expand
 * full-value env refs in values. Returns an empty object when absent or not a
 * plain object.
 */
export function sanitizeBankMap(
  map: unknown,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    const cleanKey = key.trim();
    const cleanValue = sanitizeBankValue(value, env);
    if (cleanKey && cleanValue) {
      out[cleanKey] = cleanValue;
    }
  }
  return out;
}

export const CONFIG = {
  baseUrl: getBaseUrl(),
  similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
  maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
  maxProjectMemories: fileConfig.maxProjectMemories ?? DEFAULTS.maxProjectMemories,
  maxProfileItems: fileConfig.maxProfileItems ?? DEFAULTS.maxProfileItems,
  injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
  bankPrefix: fileConfig.bankPrefix ?? DEFAULTS.bankPrefix,
  userBank: sanitizeBankValue(fileConfig.userBank),
  projectBank: sanitizeBankValue(fileConfig.projectBank),
  maxTokens: fileConfig.maxTokens ?? DEFAULTS.maxTokens,
  budget: fileConfig.budget ?? DEFAULTS.budget,
  keywordPatterns: [
    ...DEFAULT_KEYWORD_PATTERNS,
    ...(fileConfig.keywordPatterns ?? []).filter(isValidRegex),
  ],
  compactionThreshold: validateCompactionThreshold(fileConfig.compactionThreshold),
  agentProjectBanks: sanitizeBankMap(fileConfig.agentProjectBanks),
  runtimeProjectBanks: sanitizeBankMap(fileConfig.runtimeProjectBanks),
};

export function isConfigured(): boolean {
  return !!CONFIG.baseUrl;
}
