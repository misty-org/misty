import { apiRequest } from "@/api/client";
import type { ProfileMutation, SettingsProfile } from "./model";
import type { PreferenceValues } from "./registry";
const root = "/settings/preferences";
export const settingsProfilesApi = {
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
