import { spaceRequest } from "../api/api";

export interface InstalledSpaceApp {
  space_id: string;
  app_id: string;
  version: string;
  permissions: string[];
  installed_by: string;
  installed_at: string;
}

const appsPath = (spaceId: string, appId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/apps${appId ? `/${encodeURIComponent(appId)}` : ""}`;

export const spaceAppsApi = {
  list: (spaceId: string) =>
    spaceRequest<{ apps: InstalledSpaceApp[] }>(appsPath(spaceId)).then((result) => result.apps),
  install: (
    spaceId: string,
    appId: string,
    version: string,
    permissions: string[],
  ) =>
    spaceRequest<InstalledSpaceApp>(appsPath(spaceId, appId), {
      method: "PUT",
      body: JSON.stringify({ version, permissions }),
    }),
  remove: (spaceId: string, appId: string) =>
    spaceRequest(appsPath(spaceId, appId), { method: "DELETE" }),
};
