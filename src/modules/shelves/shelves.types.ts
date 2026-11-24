import { z } from 'zod';

const shelfFields = {
  name: z.string().transform((value) => value.replace(/\s+/gu, ' ').trim()).pipe(z.string().min(1).max(80)),
  tagline: z.string().max(160).nullable(),
  description: z.string().max(20_000).nullable(),
  theme: z.json().nullable(),
  icon: z.string().max(32).nullable(),
};

export const createShelfSchema = z.object({
  name: shelfFields.name,
  tagline: shelfFields.tagline.optional(),
  description: shelfFields.description.optional(),
  theme: shelfFields.theme.optional(),
  icon: shelfFields.icon.optional(),
}).strict();

export const updateShelfSchema = z.object({
  name: shelfFields.name.optional(),
  tagline: shelfFields.tagline.optional(),
  description: shelfFields.description.optional(),
  theme: shelfFields.theme.optional(),
  icon: shelfFields.icon.optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) ctx.addIssue({ code: 'custom', message: 'At least one shelf field is required.' });
});

export const shelfIdSchema = z.string().uuid();
export const shelfBookParamsSchema = z.object({ shelfId: shelfIdSchema, userBookId: z.string().uuid() }).strict();
export const addShelfBookSchema = z.object({ userBookId: z.string().uuid() }).strict();

export type CreateShelfInput = z.infer<typeof createShelfSchema>;
export type UpdateShelfInput = z.infer<typeof updateShelfSchema>;
