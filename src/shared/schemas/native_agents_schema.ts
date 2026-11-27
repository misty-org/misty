import * as z from "zod/mini";

const limited = (most: number) => z.string().check(z.maxLength(most));
const trimmed = (most: number) => z.string().check(z.trim(), z.maxLength(most));
const list = (item: number, most: number) => z.array(limited(item)).check(z.maxLength(most));

export const AgentProfileInputSchema = z.strictObject({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(80)),
  role: trimmed(160),
  description: z._default(limited(2000), ""),
  instructions: z._default(limited(16000), ""),
  icon: z._default(limited(128), ""),
  avatar: z._default(z.record(z.string(), z.json()), {}),
  voice: z.optional(z.string().check(z.maxLength(64), z.regex(/^[a-z0-9-]*$/))),
  model_mode: z._default(z.enum(["automatic", "pinned"]), "automatic"),
  model_id: z._default(limited(200), ""),
  reasoning_effort: z._default(limited(32), ""),
  enabled: z._default(z.boolean(), true),
  default_run_mode: z._default(trimmed(64), "ask"),
  engine: z.optional(limited(40)),
  engine_model: z.optional(limited(200)),
  soul: z.optional(limited(100000)),
  tools: z.optional(list(120, 200)),
  mcp_servers: z.optional(list(120, 50)),
  runtime_cwd: z.optional(limited(1000)),
  runtime_args: z.optional(list(400, 40)),
  origin: z.optional(limited(200)),
});

export const AgentProfileSchema = z.extend(AgentProfileInputSchema, {
  id: z.string(),
  owner_user_id: z.string(),
  system_managed: z.boolean(),
  space_id: z._default(z.string(), ""),
  revision: z.optional(z.int().check(z.nonnegative())),
  can_edit: z.optional(z.boolean()),
  version: z.int().check(z.positive()),
  created_at: z.string(),
  updated_at: z.string(),
});
