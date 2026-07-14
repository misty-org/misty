import { z } from "zod";

export const AgentProfileInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(160),
  description: z.string().max(2000).default(""),
  instructions: z.string().max(16000).default(""),
  icon: z.string().max(128).default("sparkles"),
  avatar: z.record(z.string(), z.json()).default({}),
  model_mode: z.enum(["automatic", "pinned"]).default("automatic"),
  model_id: z.string().max(200).default(""),
  reasoning_effort: z.string().max(32).default(""),
  enabled: z.boolean().default(true),
});

export const AgentProfileSchema = AgentProfileInputSchema.extend({
  id: z.string(),
  owner_user_id: z.string(),
  system_managed: z.boolean(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;

export type AgentProfile = z.infer<typeof AgentProfileSchema>;
