const PRIVATE_TAG_RE = /<private\b[^>]*>[\s\S]*?<\/private>/gi;

export function containsPrivateTag(content: string): boolean {
  // Non-global regex to avoid .test() lastIndex state issues on repeated calls
  return /<private\b[^>]*>[\s\S]*?<\/private>/i.test(content);
}

export function stripPrivateContent(content: string): string {
  // Reset lastIndex so repeated calls on the same string are safe
  PRIVATE_TAG_RE.lastIndex = 0;
  return content.replace(PRIVATE_TAG_RE, "[REDACTED]");
}

export function isFullyPrivate(content: string): boolean {
  const stripped = stripPrivateContent(content);
  // After stripping all private blocks, only [REDACTED] markers and whitespace may remain
  const remaining = stripped.replace(/\[REDACTED\]/g, "").trim();
  return remaining === "";
}