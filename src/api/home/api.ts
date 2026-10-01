import { apiRequest, ApiRequestError } from "@/api/client";

import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";

export type HomeAgendaResponseEntry = SpaceAgendaEntry & { space_id: string; space_name: string };

export interface HomeDashboardSnapshot {
  activity: Record<string, number>;
  recent_apps: string[];
}

async function requestHome(spaceId?: string, date?: string, fallbackSpaceId?: string) {
  const suffix = date ? "/visits" : "";
  const init = date ? { method: "POST", body: JSON.stringify({ date }) } : undefined;
  try {
    return await apiRequest<HomeDashboardSnapshot>(
      `${spaceId ? `/spaces/${encodeURIComponent(spaceId)}/home` : "/me/home"}${suffix}`,
      init,
    );
  } catch (error) {
    if (spaceId || !fallbackSpaceId || !(error instanceof ApiRequestError) || error.status !== 404)
      throw error;
    // Older servers expose account-wide history through a membership-gated
    // Space route. Read it once; summing Space snapshots would duplicate counts.
    return apiRequest<HomeDashboardSnapshot>(
      `/spaces/${encodeURIComponent(fallbackSpaceId)}/home${suffix}`,
      init,
    );
  }
}

export const homeApi = {
  snapshot: (spaceId?: string, fallbackSpaceId?: string) =>
    requestHome(spaceId, undefined, fallbackSpaceId),
  recordVisit: (spaceId: string | undefined, date: string, fallbackSpaceId?: string) =>
    requestHome(spaceId, date, fallbackSpaceId),
  /** Earliest open agenda entries across the account's Spaces, merged
   * server-side. Older servers answer 404; callers fall back per Space. */
  agenda: (from: string, to: string, limit: number) =>
    apiRequest<{ entries: HomeAgendaResponseEntry[] }>(
      `/me/home/agenda?${new URLSearchParams({ from, to, limit: String(limit) })}`,
    ),
  recordAppActivity: (appId: string) =>
    apiRequest<void>("/me/home/apps", {
      method: "POST",
      body: JSON.stringify({ app_id: appId }),
    }),
};
