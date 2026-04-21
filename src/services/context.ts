import { CONFIG } from "../config.js";

interface MemoryResult {
  text?: string;
  type?: string | null;
  similarity?: number;
}

interface MemoriesResponse {
  results?: MemoryResult[];
}

interface ProfileResponse {
  results?: MemoryResult[];
}

function extractFactText(fact: unknown): string {
  if (typeof fact === "string") return fact;
  if (fact != null && typeof fact === "object") {
    const text = (fact as { text?: string }).text;
    if (typeof text === "string") return text;
    const content = (fact as { content?: string }).content;
    if (typeof content === "string") return content;
    return JSON.stringify(fact);
  }
  return String(fact ?? "");
}

export function formatContextForPrompt(
  profile: ProfileResponse | null,
  userMemories: MemoriesResponse,
  projectMemories: MemoriesResponse
): string {
  const parts: string[] = ["[HINDSIGHT]"];

  if (CONFIG.injectProfile && profile?.results && profile.results.length > 0) {
    parts.push("\nUser Profile:");
    profile.results.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
      const text = extractFactText(fact);
      parts.push(`- ${text}`);
    });
  }

  const projectResults = projectMemories.results || [];
  if (projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    projectResults.forEach((mem) => {
      const similarity = Math.round((mem.similarity ?? 0) * 100);
      const content = mem.text || "";
      parts.push(`- [${similarity}%] ${content}`);
    });
  }

  const userResults = userMemories.results || [];
  if (userResults.length > 0) {
    parts.push("\nRelevant Memories:");
    userResults.forEach((mem) => {
      const similarity = Math.round((mem.similarity ?? 0) * 100);
      const content = mem.text || "";
      parts.push(`- [${similarity}%] ${content}`);
    });
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}