import type { PlannerCalendarServices, PlannerConnectionServices } from "./calendarServices";

/** Connection management is optional; members can view published calendars. */
export async function loadAgendaConnections(
  spaceId: string,
  canManage: boolean,
  spacesApi: Pick<PlannerCalendarServices, "calendarSources" | "integrations">,
  connectionsApi: Pick<PlannerConnectionServices, "list">,
) {
  const [sources, integrations, accounts] = await Promise.allSettled([
    spacesApi.calendarSources(spaceId),
    canManage ? spacesApi.integrations(spaceId) : Promise.resolve({ integrations: [] }),
    canManage ? connectionsApi.list() : Promise.resolve({ connections: [] }),
  ]);
  return {
    sources: sources.status === "fulfilled" ? sources.value.sources : null,
    integrations:
      integrations.status === "fulfilled"
        ? integrations.value.integrations.filter((item) => item.provider === "google")
        : [],
    accounts:
      accounts.status === "fulfilled"
        ? accounts.value.connections.filter((item) => item.provider === "google")
        : [],
    unavailable:
      sources.status === "rejected" ||
      integrations.status === "rejected" ||
      accounts.status === "rejected",
  };
}
