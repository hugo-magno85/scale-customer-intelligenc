import { z } from "zod";
import { Uuid } from "./common.js";

export const HealthClass = z.enum(["healthy", "attention", "high_risk"]);
export type HealthClass = z.infer<typeof HealthClass>;

export const Customer = z.object({
  id: Uuid,
  name: z.string(),
  segment: z.string().nullable(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  relationshipStartedAt: z.string().nullable(),
  /** Receita recorrente mensal em centavos. Nulo quando não há fonte confiável. */
  mrrCents: z.number().int().nullable(),
  mrrSource: z.enum(["manual", "crm"]).nullable(),
  status: z.enum(["active", "churned", "paused"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customer = z.infer<typeof Customer>;

export const CreateCustomerRequest = z.object({
  name: z.string().trim().min(1).max(200),
  segment: z.string().trim().max(120).nullish(),
  ownerUserId: Uuid.nullish(),
  relationshipStartedAt: z.iso.date().nullish(),
  mrrCents: z.number().int().min(0).nullish(),
});
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;

export const UpdateCustomerRequest = CreateCustomerRequest.partial().extend({
  status: z.enum(["active", "churned", "paused"]).optional(),
});
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequest>;

export const Contact = z.object({
  id: Uuid,
  customerId: Uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  createdAt: z.string(),
});
export type Contact = z.infer<typeof Contact>;

export const CreateContactRequest = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(254).nullish(),
  phone: z.string().trim().max(40).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequest>;

export const CustomerListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  ownerUserId: Uuid.optional(),
  segment: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
