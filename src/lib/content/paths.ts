// Public addresses for content. Kept apart from the database service so browser code can use it.
export function publicPath(type: "ARTICLE" | "GUIDE", slug: string): string {
  return `/${type === "GUIDE" ? "guides" : "blog"}/${slug}`;
}
