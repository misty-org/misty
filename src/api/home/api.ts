import { apiRequest } from "@/api/client";

export interface HomeDashboardSnapshot {
  activity: Record<string, number>;
  recent_apps: string[];
}

export const homeApi = {
  snapshot: (spaceId: string) =>
    apiRequest<HomeDashboardSnapshot>(`/spaces/${encodeURIComponent(spaceId)}/home`),
  recordVisit: (spaceId: string, date: string) =>
    apiRequest<HomeDashboardSnapshot>(`/spaces/${encodeURIComponent(spaceId)}/home/visits`, {
      method: "POST",
      body: JSON.stringify({ date }),
    }),
  recordAppActivity: (appId: string) =>
    apiRequest<void>("/me/home/apps", {
      method: "POST",
      body: JSON.stringify({ app_id: appId }),
    }),
};
