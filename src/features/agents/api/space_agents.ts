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
});
export type SpaceAgent = z.infer<typeof spaceAgentSchema>;

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
  async add(spaceId: string, agentId: string, name: string) {
    return spaceAgentSchema.parse(
      await apiRequest<unknown>(spacePath(spaceId, agentId), {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    );
  },
  async remove(spaceId: string, agentId: string) {
    await apiRequest<unknown>(spacePath(spaceId, agentId), { method: "DELETE" });
  },
};
