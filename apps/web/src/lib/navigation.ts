/**
 * Returns `value` when it is a safe same-site path to redirect to after sign-in, otherwise
 * `fallback`. Blocks absolute URLs, protocol-relative URLs (`//evil.example`) and backslash tricks.
 */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function loginPath(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}
