import { z } from "zod";

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Pagination = z.infer<typeof Pagination>;

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Slug = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use letras minúsculas, números e hífens");
