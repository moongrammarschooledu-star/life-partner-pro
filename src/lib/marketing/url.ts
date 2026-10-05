// https-only URL check with a host allow-list. Returns the normalised URL or null. Used for canonical URLs and social
// images (so a marketing editor cannot point SEO metadata at an arbitrary external host).
export function sanitizeHttpsUrl(raw: string, allowedHosts: string[]): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!allowedHosts.map((h) => h.toLowerCase()).includes(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch {
    return null;
  }
}
