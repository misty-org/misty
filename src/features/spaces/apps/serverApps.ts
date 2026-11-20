import { spaceRequest } from "../api/api";
import type { AppSource } from "./thirdPartyApps";

/** One app a Space has installed, as the server records it. */
export interface InstalledSpaceApp {
  space_id: string;
  app_id: string;
  version: string;
  /** What a mod approved at install. */
  permissions: string[];
  installed_by: string;
  installed_at: string;
  /** For an app added by its link rather than from Misty's catalog: its pinned build. */
  source?: AppSource | null;
}

const appsPath = (spaceId: string, appId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/apps${appId ? `/${encodeURIComponent(appId)}` : ""}`;

/** A Space's added apps (misty-server `space_apps`). */
export const spaceAppsApi = {
  list: (spaceId: string) =>
    spaceRequest<{ apps: InstalledSpaceApp[] }>(appsPath(spaceId)).then((result) => result.apps),
  /** For a mod. Installs the app, or moves an installed one to this version and these permissions. */
  install: (
    spaceId: string,
    appId: string,
    version: string,
    permissions: string[],
    source?: AppSource,
  ) =>
    spaceRequest<InstalledSpaceApp>(appsPath(spaceId, appId), {
      method: "PUT",
      body: JSON.stringify(source ? { version, permissions, source } : { version, permissions }),
    }),
  /** For a mod. The Space's files stay; only the app goes. */
  remove: (spaceId: string, appId: string) =>
    spaceRequest(appsPath(spaceId, appId), { method: "DELETE" }),
};
