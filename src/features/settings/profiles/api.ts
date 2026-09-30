import { apiRequest, ApiRequestError } from "@/api/client";
import type { ProfileMutation, SettingsProfile } from "./model";
import type { PreferenceValues } from "./registry";
const root = "/settings/preferences";
export const settingsProfilesApi = {
  /** Read-only refresh: `undefined` means the held revision is still current,
   * `null` means the account has no record yet (or the server predates reads). */
  read: async (since?: number): Promise<SettingsProfile | null | undefined> => {
    try {
      return await apiRequest<SettingsProfile | undefined>(
        since === undefined ? root : `${root}?since=${since}`,
      );
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 405))
        return null;
      throw error;
    }
  },
  ensure: (values: PreferenceValues) =>
    apiRequest<SettingsProfile>(root, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
  patch: (edit: ProfileMutation) =>
    apiRequest<SettingsProfile>(root, {
      method: "PATCH",
      body: JSON.stringify({ mutationId: edit.id, set: edit.set, unset: edit.unset }),
    }),
};
