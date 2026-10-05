import { z } from "zod";
import { apiRequest } from "@/api/client";

/** How a published agent takes requests from other members' agents. */
export const acceptPolicies = ["ask", "auto", "off"] as const;
export type AcceptPolicy = (typeof acceptPolicies)[number];

const listingSchema = z.object({
  space_id: z.string(),
  space_name: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string(),
  description: z.string(),
  accept_policy: z.enum(acceptPolicies),
  max_open_requests: z.number().int(),
});
export type AgentListing = z.infer<typeof listingSchema>;

const requestSchema = z.object({
  id: z.string(),
  space_id: z.string(),
  space_name: z.string(),
  requester_name: z.string(),
  target_agent_id: z.string(),
  target_agent_name: z.string(),
  message: z.string(),
  approval: z.string(),
  created_at: z.string(),
});
export type AgentMemberRequest = z.infer<typeof requestSchema>;

const spacePath = (spaceId: string, agentId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/agent-listings${agentId ? `/${encodeURIComponent(agentId)}` : ""}`;

// Trusted host controls only: never register this API in the app RPC catalog.
export const agentMemberRequestsApi = {
  async pending(signal?: AbortSignal) {
    return z
      .object({ requests: z.array(requestSchema).max(100) })
      .parse(await apiRequest<unknown>("/me/agent-requests", { signal }));
  },
  async decide(id: string, approve: boolean, signal?: AbortSignal) {
    return apiRequest<unknown>(
      `/agent-requests/${encodeURIComponent(id)}/${approve ? "approve" : "decline"}`,
      { method: "POST", signal },
    );
  },
  async listings(spaceId: string, signal?: AbortSignal) {
    return z
      .object({ listings: z.array(listingSchema) })
      .parse(await apiRequest<unknown>(spacePath(spaceId), { signal }));
  },
  async publish(
    spaceId: string,
    agentId: string,
    policy: Exclude<AcceptPolicy, "off">,
    description = "",
  ) {
    return listingSchema.parse(
      await apiRequest<unknown>(spacePath(spaceId, agentId), {
        method: "PUT",
        body: JSON.stringify({ accept_policy: policy, description }),
      }),
    );
  },
  async unpublish(spaceId: string, agentId: string) {
    await apiRequest<unknown>(spacePath(spaceId, agentId), { method: "DELETE" });
  },
};
