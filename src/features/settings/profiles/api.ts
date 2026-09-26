import { apiRequest } from "@/api/client";
import type { SettingsProfile, ProfileMutation } from "./model";
import type { PreferenceValues } from "./registry";
const root = "/settings/profiles";
export const settingsProfilesApi = {
  list: () => apiRequest<{ profiles: SettingsProfile[] }>(root, { cache: "no-store" }),
  create: (id: string, name: string, values: PreferenceValues) =>
    apiRequest<SettingsProfile>(root, {
      method: "POST",
      body: JSON.stringify({ id, name, values }),
    }),
  patch: (edit: ProfileMutation) =>
    apiRequest<SettingsProfile>(`${root}/${encodeURIComponent(edit.profileId)}`, {
      method: "PATCH",
      body: JSON.stringify({ mutationId: edit.id, set: edit.set, unset: edit.unset }),
    }),
  rename: (id: string, name: string, mutationId: string) =>
    apiRequest<SettingsProfile>(`${root}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ mutationId, name, set: {}, unset: [] }),
    }),
  remove: (id: string) =>
    apiRequest<void>(`${root}/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
