import type * as z from "zod/mini";
import { apiRequest } from "@/api/client";
import type { spaceAgentSchema } from "./space_agents_schema";

const schemas = () => import("./space_agents_schema");

export type SpaceAgent = z.output<typeof spaceAgentSchema>;

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

const spacePath = (spaceId: string, agentId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/agents${agentId ? `/${encodeURIComponent(agentId)}` : ""}`;

export const spaceAgentsApi = {
  async list(spaceId: string, signal?: AbortSignal) {
    const [{ agentsSchema }, body] = await Promise.all([
      schemas(),
      apiRequest<unknown>(spacePath(spaceId), { signal }),
    ]);
    return agentsSchema.parse(body);
  },
  async mine(signal?: AbortSignal) {
    const [{ agentsSchema }, body] = await Promise.all([
      schemas(),
      apiRequest<unknown>("/me/space-agents", { signal }),
    ]);
    return agentsSchema.parse(body);
  },
  async put(spaceId: string, agentId: string, definition: SpaceAgentDefinition) {
    const [{ spaceAgentSchema: schema }, body] = await Promise.all([
      schemas(),
      apiRequest<unknown>(spacePath(spaceId, agentId), {
        method: "PUT",
        body: JSON.stringify(definition),
      }),
    ]);
    return schema.parse(body);
  },
  async remove(spaceId: string, agentId: string) {
    await apiRequest<unknown>(spacePath(spaceId, agentId), { method: "DELETE" });
  },
};
