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
  set: PreferenceValues;
  unset: string[];
}
/** A cache and durable outbox for the single server-owned account settings record. */
export interface DeviceProfileState {
  version: 2;
  profile: SettingsProfile | null;
  seed: PreferenceValues;
  outbox: ProfileMutation[];
}
export function initialProfileState(document: Record<string, unknown>): DeviceProfileState {
  return { version: 2, profile: null, seed: portableValues(document), outbox: [] };
}
/** Import the old effective preferences once; the server's existing record always wins. */
export function migrateProfileState(
  saved: unknown,
  document: Record<string, unknown>,
): DeviceProfileState {
  if (!saved || typeof saved !== "object") return initialProfileState(document);
  const legacy = saved as {
    version?: number;
    selectedProfileId?: string | null;
    profiles?: Record<string, SettingsProfile>;
    localValues?: PreferenceValues;
    overrides?: Record<string, PreferenceValues>;
    outbox?: (ProfileMutation & { profileId: string })[];
  };
  if (legacy.version === 2) return withoutRetiredSettings(saved as DeviceProfileState);
  const next = initialProfileState(document);
  const selected = legacy.selectedProfileId;
  Object.assign(next.seed, selected ? legacy.profiles?.[selected]?.values : legacy.localValues);
  for (const edit of legacy.outbox ?? []) {
    if (edit.profileId !== selected) continue;
    Object.assign(next.seed, edit.set);
    for (const key of edit.unset) delete next.seed[key];
  }
  if (selected) Object.assign(next.seed, legacy.overrides?.[selected]);
  next.seed = Object.fromEntries(
    Object.entries(next.seed).filter(([id, value]) => {
      const d = definitionById.get(id);
      return d && validPreference(d, value);
    }),
  );
  return next;
}
/** Queued edits to retired settings would be rejected by the server and block every later save. */
function withoutRetiredSettings(state: DeviceProfileState): DeviceProfileState {
  const outbox = state.outbox
    .map((edit) => ({
      ...edit,
      set: Object.fromEntries(Object.entries(edit.set).filter(([id]) => definitionById.has(id))),
      unset: edit.unset.filter((id) => definitionById.has(id)),
    }))
    .filter((edit) => Object.keys(edit.set).length > 0 || edit.unset.length > 0);
  return { ...state, outbox };
}
export function effectiveValues(state: DeviceProfileState): PreferenceValues {
  const values = { ...(state.profile?.values ?? state.seed) };
  for (const edit of state.outbox) {
    Object.assign(values, edit.set);
    for (const key of edit.unset) delete values[key];
  }
  return values;
}
export function resolveSetting(state: DeviceProfileState, id: string) {
  const d = definitionById.get(id);
  if (!d) throw new Error("Unknown setting");
  const values = effectiveValues(state);
  return {
    value: values[id] ?? d.default,
    source: values[id] === undefined ? "default" : "account",
  };
}
export function editPreference(
  state: DeviceProfileState,
  id: string,
  value: PreferenceValue | undefined,
  mutationId: string,
): DeviceProfileState {
  const d = definitionById.get(id);
  if (!d || (value !== undefined && !validPreference(d, value))) throw new Error("Invalid setting");
  if (effectiveValues(state)[id] === value) return state;
  return {
    ...state,
    outbox: [
      ...state.outbox,
      {
        id: mutationId,
        set: value === undefined ? {} : { [id]: value },
        unset: value === undefined ? [id] : [],
      },
    ],
  };
}
export function reconcileProfile(
  state: DeviceProfileState,
  profile: SettingsProfile,
): DeviceProfileState {
  if (state.profile?.id === profile.id && state.profile.revision >= profile.revision) return state;
  return { ...state, profile, seed: {} };
}
