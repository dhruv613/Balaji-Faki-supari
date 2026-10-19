/** Only same-site relative paths may be used as a post-login destination (no open redirects). */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\r\n]/.test(raw)) return fallback;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return fallback;
  return raw;
}
