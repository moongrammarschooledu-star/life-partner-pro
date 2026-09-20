// Whether a server-side admin session row is still usable (not revoked, not
// expired). Lives outside the layout component because reading the clock during
// render trips the react-hooks purity lint rule.
export function isAdminSessionUsable(record: { revokedAt: Date | null; expiresAt: Date } | null, now: number = Date.now()): boolean {
  return Boolean(record) && !record!.revokedAt && record!.expiresAt.getTime() >= now;
}
