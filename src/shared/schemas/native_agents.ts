import type * as z from "zod/mini";
import type { AgentProfileInputSchema, AgentProfileSchema } from "./native_agents_schema";

export type AgentProfileInput = z.output<typeof AgentProfileInputSchema>;

export type AgentProfile = z.output<typeof AgentProfileSchema>;

export const agentDefinitionKeys = [
  "name",
  "role",
  "description",
  "instructions",
  "soul",
  "icon",
  "avatar",
  "voice",
  "engine",
  "engine_model",
  "reasoning_effort",
  "origin",
] as const satisfies readonly (keyof AgentProfileInput)[];

export const agentPersonalKeys = [
  "enabled",
  "default_run_mode",
  "tools",
  "mcp_servers",
  "runtime_cwd",
  "runtime_args",
  "model_mode",
  "model_id",
] as const satisfies readonly (keyof AgentProfileInput)[];

export type AgentDefinition = Pick<AgentProfileInput, (typeof agentDefinitionKeys)[number]>;

export type AgentPersonal = Pick<AgentProfileInput, (typeof agentPersonalKeys)[number]>;
