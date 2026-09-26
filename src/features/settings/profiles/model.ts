import {
  definitionById,
  portableValues,
  validPreference,
  type PreferenceValues,
  type PreferenceValue,
} from "./registry";
export interface SettingsProfile {
  id: string;
  name: string;
  schemaVersion: number;
  revision: number;
  values: PreferenceValues;
}
export interface ProfileMutation {
  id: string;
  profileId: string;
  set: PreferenceValues;
  unset: string[];
}
export interface DeviceProfileState {
  version: 1;
  selectedProfileId: string | null;
  profiles: Record<string, SettingsProfile>;
  localValues: PreferenceValues;
  overrides: Record<string, PreferenceValues>;
  outbox: ProfileMutation[];
  notice: string | null;
}
export interface ResolvedSetting {
  value: PreferenceValue;
  source: "default" | "profile" | "device";
}
export function initialProfileState(document: Record<string, unknown>): DeviceProfileState {
  return {
    version: 1,
    selectedProfileId: null,
    profiles: {},
    localValues: portableValues(document),
    overrides: {},
    outbox: [],
    notice: null,
  };
}
export function profileValues(
  state: DeviceProfileState,
  profileId = state.selectedProfileId,
): PreferenceValues {
  if (!profileId) return state.localValues;
  const values = { ...state.profiles[profileId]?.values };
  for (const edit of state.outbox)
    if (edit.profileId === profileId) {
      Object.assign(values, edit.set);
      for (const key of edit.unset) delete values[key];
    }
  return values;
}
export function effectiveValues(state: DeviceProfileState): PreferenceValues {
  return {
    ...profileValues(state),
    ...(state.selectedProfileId ? state.overrides[state.selectedProfileId] : {}),
  };
}
export function resolveSetting(state: DeviceProfileState, id: string): ResolvedSetting {
  const d = definitionById.get(id);
  if (!d) throw new Error("Unknown setting");
  const overrides = state.selectedProfileId
    ? state.overrides[state.selectedProfileId]
    : state.localValues;
  if (overrides?.[id] !== undefined) return { value: overrides[id], source: "device" };
  const values = profileValues(state);
  return {
    value: values[id] ?? d.default,
    source: values[id] === undefined ? "default" : "profile",
  };
}
export function editPreference(
  state: DeviceProfileState,
  id: string,
  value: PreferenceValue | undefined,
  target: "profile" | "device",
  mutationId: string,
): DeviceProfileState {
  const d = definitionById.get(id);
  if (!d || d.owner !== "profile" || (value !== undefined && !validPreference(d, value)))
    throw new Error("Invalid portable setting");
  const next = structuredClone(state);
  if (!next.selectedProfileId || target === "device") {
    const values = next.selectedProfileId
      ? (next.overrides[next.selectedProfileId] ??= {})
      : next.localValues;
    if (value === undefined) delete values[id];
    else values[id] = value;
  } else {
    next.outbox.push({
      id: mutationId,
      profileId: next.selectedProfileId,
      set: value === undefined ? {} : { [id]: value },
      unset: value === undefined ? [id] : [],
    });
  }
  return next;
}
export function reconcileProfiles(
  state: DeviceProfileState,
  profiles: SettingsProfile[],
): DeviceProfileState {
  const next = structuredClone(state);
  const ids = new Set(profiles.map((p) => p.id));
  if (next.selectedProfileId && !ids.has(next.selectedProfileId)) {
    next.localValues = effectiveValues(next);
    next.selectedProfileId = null;
    next.notice =
      "The selected profile was deleted. Your preferences are now local to this device.";
  }
  for (const id of Object.keys(next.profiles))
    if (!ids.has(id)) {
      // Preserve unsent edits to a deleted inactive profile in a local recovery copy.
      if (next.outbox.some((m) => m.profileId === id))
        next.overrides["deleted:" + id] = profileValues(next, id);
      delete next.profiles[id];
      next.outbox = next.outbox.filter((m) => m.profileId !== id);
    }
  for (const profile of profiles)
    if (!next.profiles[profile.id] || profile.revision >= next.profiles[profile.id].revision)
      next.profiles[profile.id] = profile;
  return next;
}
