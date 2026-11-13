import { z } from "zod";

export const AgentProfileInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(160),
  description: z.string().max(2000).default(""),
  instructions: z.string().max(16000).default(""),
  icon: z.string().max(128).default(""),
  avatar: z.record(z.string(), z.json()).default({}),
  model_mode: z.enum(["automatic", "pinned"]).default("automatic"),
  model_id: z.string().max(200).default(""),
  reasoning_effort: z.string().max(32).default(""),
  enabled: z.boolean().default(true),
  /** How new chats with this agent start: one of its engine's own mode ids, or an older "ask" or "auto". */
  default_run_mode: z.string().trim().max(64).default("ask"),
  /** The engine this agent runs on: Misty's own when absent, or an outside engine's adapter id. */
  engine: z.string().max(40).optional(),
  /** The model an outside engine is asked for; empty takes the engine's own default. */
  engine_model: z.string().max(200).optional(),
  /** Who the agent is, kept apart from how it works (a bot bundle's SOUL.md). */
  soul: z.string().max(100000).optional(),
  /** The tools this agent may use, by Misty's own names; empty or absent allows every tool. */
  tools: z.array(z.string().max(120)).max(200).optional(),
  /** The MCP servers this agent is given, by name. */
  mcp_servers: z.array(z.string().max(120)).max(50).optional(),
  /** The folder an outside engine starts in, and extra arguments it is started with. */
  runtime_cwd: z.string().max(1000).optional(),
  runtime_args: z.array(z.string().max(400)).max(40).optional(),
  /** The bot bundle or persona this agent was made from, if any. */
  origin: z.string().max(200).optional(),
});

export const AgentProfileSchema = AgentProfileInputSchema.extend({
  id: z.string(),
  owner_user_id: z.string(),
  system_managed: z.boolean(),
  /** The agent's home Space: the one Space its runs work and save in (`agents/personal/agentHomeSpace`). */
  space_id: z.string().default(""),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;

export type AgentProfile = z.infer<typeof AgentProfileSchema>;
