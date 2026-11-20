import { spaceRequest } from "../api/api";

/** One app a Space has installed, as the server records it. */
export interface InstalledSpaceApp {
  space_id: string;
  app_id: string;
  version: string;
  /** What a mod approved at install. */
  permissions: string[];
  installed_by: string;
  installed_at: string;
}

export interface AppStorageValue {
  key: string;
  value: unknown;
  updated_at: string;
}

const appsPath = (spaceId: string, appId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/apps${appId ? `/${encodeURIComponent(appId)}` : ""}`;
const storagePath = (spaceId: string, appId: string, key = "") =>
  `${appsPath(spaceId, appId)}/storage${key ? `/${encodeURIComponent(key)}` : ""}`;

/** A Space's installed apps and the small JSON each keeps there (misty-server `space_apps`). */
export const spaceAppsApi = {
  list: (spaceId: string) =>
    spaceRequest<{ apps: InstalledSpaceApp[] }>(appsPath(spaceId)).then((result) => result.apps),
  /** For a mod. Installs the app, or moves an installed one to this version and these permissions. */
  install: (spaceId: string, appId: string, version: string, permissions: string[]) =>
    spaceRequest<InstalledSpaceApp>(appsPath(spaceId, appId), {
      method: "PUT",
      body: JSON.stringify({ version, permissions }),
    }),
  /** For a mod. The Space's files stay; only the app and its storage go. */
  remove: (spaceId: string, appId: string) =>
    spaceRequest(appsPath(spaceId, appId), { method: "DELETE" }),
  storage: {
    get: (spaceId: string, appId: string, key: string) =>
      spaceRequest<AppStorageValue>(storagePath(spaceId, appId, key)),
    set: (spaceId: string, appId: string, key: string, value: unknown) =>
      spaceRequest<AppStorageValue>(storagePath(spaceId, appId, key), {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
    list: (spaceId: string, appId: string, prefix = "") =>
      spaceRequest<{ values: AppStorageValue[] }>(
        `${storagePath(spaceId, appId)}${prefix ? `?${new URLSearchParams({ prefix })}` : ""}`,
      ).then((result) => result.values),
    remove: (spaceId: string, appId: string, key: string) =>
      spaceRequest(storagePath(spaceId, appId, key), { method: "DELETE" }),
  },
};
