import * as z from "zod/mini";

const text = () => z._default(z.string(), "");

export const spaceAgentSchema = z.object({
  space_id: z.string(),
  space_name: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string(),
  added_at: z.string(),
  visibility: z._default(z.enum(["public", "private"]), "public"),
  role: text(),
  description: text(),
  instructions: text(),
  soul: text(),
  icon: text(),
  avatar: z.pipe(
    z.nullish(z.record(z.string(), z.json())),
    z.transform((value) => value ?? {}),
  ),
  voice_id: text(),
  engine_id: text(),
  engine_model: text(),
  reasoning_effort: text(),
  origin: text(),
  revision: z._default(z.int().check(z.nonnegative()), 0),
  updated_at: text(),
  updated_by_user_id: z.optional(z.string()),
  can_edit: z._default(z.boolean(), false),
});
export const agentsSchema = z.object({ agents: z.array(spaceAgentSchema) });
