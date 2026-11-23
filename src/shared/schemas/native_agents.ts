import { z } from "zod";

export const AgentProfileInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(160),
  description: z.string().max(2000).default(""),
  instructions: z.string().max(16000).default(""),
  icon: z.string().max(128).default(""),
  avatar: z.record(z.string(), z.json()).default({}),
  voice: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]*$/)
    .optional(),
  model_mode: z.enum(["automatic", "pinned"]).default("automatic"),
  model_id: z.string().max(200).default(""),
  reasoning_effort: z.string().max(32).default(""),
  enabled: z.boolean().default(true),
  default_run_mode: z.string().trim().max(64).default("ask"),
  engine: z.string().max(40).optional(),
  engine_model: z.string().max(200).optional(),
  soul: z.string().max(100000).optional(),
  tools: z.array(z.string().max(120)).max(200).optional(),
  mcp_servers: z.array(z.string().max(120)).max(50).optional(),
  runtime_cwd: z.string().max(1000).optional(),
  runtime_args: z.array(z.string().max(400)).max(40).optional(),
  origin: z.string().max(200).optional(),
});

export const AgentProfileSchema = AgentProfileInputSchema.extend({
  id: z.string(),
  owner_user_id: z.string(),
  system_managed: z.boolean(),
  space_id: z.string().default(""),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;

export type AgentProfile = z.infer<typeof AgentProfileSchema>;
