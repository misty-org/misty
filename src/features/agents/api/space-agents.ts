import { z } from "zod";
import { apiRequest } from "@/api/client";

/**
 * An agent listed in a Space, under the person who owns it. The agent lives on that person's
 * computer: the Space keeps its id and name, and nothing else.
 */
const spaceAgentSchema = z.object({
  space_id: z.string(),
  space_name: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string(),
  added_at: z.string(),
  /** A private agent is invisible to the rest of the Space and can't be @mentioned there. */
  visibility: z.enum(["public", "private"]).default("public"),
});
export type SpaceAgent = z.infer<typeof spaceAgentSchema>;

const agentsSchema = z.object({ agents: z.array(spaceAgentSchema) });
const spacePath = (spaceId: string, agentId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/agents${agentId ? `/${encodeURIComponent(agentId)}` : ""}`;

export const spaceAgentsApi = {
  /** The agents in one Space. */
  async list(spaceId: string, signal?: AbortSignal) {
    return agentsSchema.parse(await apiRequest<unknown>(spacePath(spaceId), { signal }));
  },
  /** The agents in every Space the person belongs to. */
  async mine(signal?: AbortSignal) {
    return agentsSchema.parse(await apiRequest<unknown>("/me/space-agents", { signal }));
  },
  /** Lists one of the person's agents in a Space they belong to, by its name alone. */
  async add(spaceId: string, agentId: string, name: string) {
    return spaceAgentSchema.parse(
      await apiRequest<unknown>(spacePath(spaceId, agentId), {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    );
  },
  /** Takes an agent out; its owner or the Space's owner may. */
  async remove(spaceId: string, agentId: string) {
    await apiRequest<unknown>(spacePath(spaceId, agentId), { method: "DELETE" });
  },
};
