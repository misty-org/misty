import { cachedRequest } from "@/api/cache/cached-request";
import { apiRequest } from "@/api/client";

interface FrontierModel {
  id: string;
  name: string;
  provider_id: string;
  provider_name: string;
  capabilities: string[];
  reasoning_levels: Array<"default" | "low" | "medium" | "high" | "xhigh">;
}

interface FrontierModelCatalog {
  catalog_version: string;
  default_model_id: string;
  models: FrontierModel[];
}

export const assistantApi = {
  conversations: <T>(query = "", onCached?: (value: { conversations: T[] }) => void) =>
    cachedRequest<{ conversations: T[] }>(
      `/misty/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      { onCached },
    ),
  /**
   * The device that starts a chat keeps it (docs/design/agent-chats-local/BRIEF.md);
   * without a device the chat waits in the inbox for the first device to take it.
   */
  createConversation: <T>(title: string, spaceId?: string, agentId?: string, deviceId?: string) =>
    apiRequest<T>("/misty/conversations", {
      method: "POST",
      body: JSON.stringify({ title, space_id: spaceId, agent_id: agentId, device_id: deviceId }),
    }),
  /**
   * What a device needs for its local chats: "legacy" is the one-time copy of chats from
   * before chats moved to devices; "device" is this device's chats that ran in the last
   * two days, and the inbox of chats no device keeps yet.
   */
  conversationsInScope: <T>(scope: "legacy" | "device", deviceId = "") =>
    apiRequest<{ conversations: T[] }>(
      `/misty/conversations?${new URLSearchParams({ scope, ...(deviceId ? { device_id: deviceId } : {}) })}`,
    ),
  /** Takes a chat from the inbox, or one from before chats moved to devices, for this device. */
  keepConversationOnDevice: (conversationId: string, deviceId: string) =>
    apiRequest<{ id: string; keptOnDeviceId: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ keep_on_device: deviceId }) },
    ),
  deleteConversation: (conversationId: string) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  renameConversation: (conversationId: string, title: string) =>
    apiRequest<{ id: string; title: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    ),
  /** Records that the user has seen the conversation now. */
  markConversationRead: (conversationId: string) =>
    apiRequest<{ id: string; lastReadAt: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ read: true }) },
    ),
  frontierModels: () => apiRequest<FrontierModelCatalog>("/ai/models"),
  complete: (prompt: string) =>
    apiRequest<{ text: string }>("/ai/complete", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      }),
    }),
};
