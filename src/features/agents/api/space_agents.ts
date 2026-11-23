import { z } from "zod";
import { apiRequest } from "@/api/client";

const spaceAgentSchema = z.object({
  space_id: z.string(),
  space_name: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string(),
  added_at: z.string(),
  visibility: z.enum(["public", "private"]).default("public"),
  role: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  soul: z.string().default(""),
  icon: z.string().default(""),
  avatar: z.record(z.string(), z.json()).nullish().transform((value) => value ?? {}),
  voice_id: z.string().default(""),
  engine_id: z.string().default(""),
  engine_model: z.string().default(""),
  reasoning_effort: z.string().default(""),
  origin: z.string().default(""),
  revision: z.number().int().nonnegative().default(0),
  updated_at: z.string().default(""),
  updated_by_user_id: z.string().optional(),
  can_edit: z.boolean().default(false),
});
export type SpaceAgent = z.infer<typeof spaceAgentSchema>;

export interface SpaceAgentDefinition {
  name: string;
  role: string;
  description: string;
  instructions: string;
  soul: string;
  icon: string;
  avatar: Record<string, unknown>;
  voice_id: string;
  engine_id: string;
  engine_model: string;
  reasoning_effort: string;
  origin: string;
  revision: number;
}

const agentsSchema = z.object({ agents: z.array(spaceAgentSchema) });
const spacePath = (spaceId: string, agentId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/agents${agentId ? `/${encodeURIComponent(agentId)}` : ""}`;

export const spaceAgentsApi = {
  async list(spaceId: string, signal?: AbortSignal) {
    return agentsSchema.parse(await apiRequest<unknown>(spacePath(spaceId), { signal }));
  },
  async mine(signal?: AbortSignal) {
    return agentsSchema.parse(await apiRequest<unknown>("/me/space-agents", { signal }));
  },
  async put(spaceId: string, agentId: string, definition: SpaceAgentDefinition) {
    return spaceAgentSchema.parse(
      await apiRequest<unknown>(spacePath(spaceId, agentId), {
        method: "PUT",
        body: JSON.stringify(definition),
      }),
    );
  },
  async remove(spaceId: string, agentId: string) {
    await apiRequest<unknown>(spacePath(spaceId, agentId), { method: "DELETE" });
  },
};
