import { z } from "zod";

// Request bodies for the content admin API. Length limits here are generous guards against oversized input; the service enforces the
// editorial limits (title 5-150, summary 20-300, text 50-50,000, ...).
const type = z.enum(["ARTICLE", "GUIDE"]);

export const createPostSchema = z.object({
  type,
  slug: z.string().max(80),
  title: z.string().max(300),
  summary: z.string().max(600),
  body: z.string().max(60_000),
  authorId: z.string().min(1).max(40),
  categoryId: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(400).nullable().optional(),
  noindex: z.boolean().optional(),
});

export const updatePostSchema = createPostSchema.omit({ type: true }).partial();

export const transitionSchema = z.object({
  action: z.enum(["SUBMIT", "PUBLISH", "SCHEDULE", "UNSCHEDULE", "ARCHIVE", "RESTORE", "REQUEST_CHANGES"]),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
});

export const authorSchema = z.object({ name: z.string().max(200), bio: z.string().max(1000).nullable().optional() });

export const categorySchema = z.object({ type, slug: z.string().max(80), name: z.string().max(200), description: z.string().max(400).nullable().optional() });
