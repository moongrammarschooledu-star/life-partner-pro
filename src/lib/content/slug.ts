export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// "new", "category" and similar would collide with fixed routes under /blog and /guides.
const RESERVED = new Set(["new", "category", "tag", "page", "feed", "rss", "search", "admin", "api"]);

export function validateSlug(slug: string): string | null {
  if (slug.length < 3 || slug.length > 80) return "The address must be 3 to 80 characters.";
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters, digits and single hyphens only.";
  if (RESERVED.has(slug)) return "That address is reserved.";
  return null;
}
