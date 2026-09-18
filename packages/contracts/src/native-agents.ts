import { z } from "zod";

/** Personal agent contracts. Management and execution activation belong to the host. */
export const AgentExecutionModeSchema = z.enum(["user", "agent", "team"]);
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
  id: z.string(), owner_user_id: z.string(), system_managed: z.boolean(),
  version: z.number().int().positive(), created_at: z.string(), updated_at: z.string(),
});
export const AgentAppAssignmentsSchema = z.strictObject({
  agent_id: z.string().min(1), space_id: z.string().min(1),
  app_ids: z.array(z.string().min(1).max(128)).max(200),
});
export const AgentTaskContextSchema = z.strictObject({
  taskId: z.string().min(1).max(128), agentId: z.string().min(1), spaceId: z.string().min(1),
  executionMode: AgentExecutionModeSchema, windowLabel: z.string().min(1).max(128),
});
export const AgentIntegrationDestinationSchema = z.strictObject({
  id: z.string().min(1).max(256), appId: z.string().min(1).max(128),
  providerId: z.string().min(1).max(128), accountId: z.string().min(1).max(256),
  label: z.string().min(1).max(256), url: z.url().max(8192),
});
export const AgentTaskArtifactSchema = z.strictObject({
  id: z.string().min(1), taskId: z.string().min(1), name: z.string().max(1024),
  mimeType: z.string().max(255), byteSize: z.number().int().nonnegative(),
  state: z.enum(["pending", "ready", "failed"]),
});
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeSchema>;
export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type AgentAppAssignments = z.infer<typeof AgentAppAssignmentsSchema>;
export type AgentTaskContext = z.infer<typeof AgentTaskContextSchema>;
export type AgentIntegrationDestination = z.infer<typeof AgentIntegrationDestinationSchema>;
export type AgentTaskArtifact = z.infer<typeof AgentTaskArtifactSchema>;
