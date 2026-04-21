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
  return `${CONFIG.bankPrefix}_project_${sha256(directory)}`;
}

export function getBanks(directory: string): { user: string; project: string } {
  return {
    user: getUserBank(),
    project: getProjectBank(directory),
  };
}