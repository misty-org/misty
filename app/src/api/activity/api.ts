import { apiRequest } from "@/api/client";
import type { SpaceInboxItem } from "@/api/spaces/dto/interfaces/types";

export type ActivityInboxTab = "unreads" | "mentions";

export const activityApi = {
  inbox: (tab: ActivityInboxTab) =>
    apiRequest<{ items: SpaceInboxItem[] }>(`/activity/inbox?tab=${tab}`),
  markSeen: () => apiRequest("/activity/inbox/seen", { method: "POST" }),
  clearInbox: (tab: ActivityInboxTab) =>
    apiRequest("/activity/inbox/clear", {
      method: "POST",
      body: JSON.stringify({ tab }),
    }),
};
