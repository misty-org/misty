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
  /** How new chats with this agent start: Ask pauses before every change, Auto continues on remembered approvals. */
  default_run_mode: z.enum(["ask", "auto"]).default("ask"),
  /** The one Space the agent lives in. Omit to create it in the personal Space. */
  space_id: z.string().max(200).optional(),
});

export const AgentProfileSchema = AgentProfileInputSchema.extend({
  id: z.string(),
  owner_user_id: z.string(),
  system_managed: z.boolean(),
  /** Who does the work: Misty's cloud loop, or a coding tool on the person's device. */
  runner: z.string().default("misty"),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;

export type AgentProfile = z.infer<typeof AgentProfileSchema>;
