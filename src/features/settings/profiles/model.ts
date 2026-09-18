import {
  definitionById,
  portableValues,
  validPreference,
  type PreferenceValues,
  type PreferenceValue,
} from "./registry";
/** This device's preference values. Settings never leave the device. */
export interface DeviceProfileState {
  version: 3;
  values: PreferenceValues;
}
export function initialProfileState(document: Record<string, unknown>): DeviceProfileState {
  return { version: 3, values: portableValues(document) };
}
const validValues = (values: PreferenceValues): PreferenceValues =>
  Object.fromEntries(
    Object.entries(values).filter(([id, value]) => {
      const d = definitionById.get(id);
      return d && validPreference(d, value);
    }),
  );
/**
 * Reads what an earlier build saved. Earlier states carried a copy of a server record and a
 * queue of edits waiting to be sent; what the person last saw (the copy with the edits
 * applied) becomes this device's values, and the rest is dropped.
 */
export function migrateProfileState(
  saved: unknown,
  document: Record<string, unknown>,
): DeviceProfileState {
  if (!saved || typeof saved !== "object") return initialProfileState(document);
  const state = saved as {
    version?: number;
    values?: PreferenceValues;
    profile?: { values?: PreferenceValues } | null;
    seed?: PreferenceValues;
    outbox?: { set?: PreferenceValues; unset?: string[] }[];
    selectedProfileId?: string | null;
    profiles?: Record<string, { values?: PreferenceValues }>;
    localValues?: PreferenceValues;
    overrides?: Record<string, PreferenceValues>;
  };
  if (state.version === 3) return { version: 3, values: validValues(state.values ?? {}) };
  const values: PreferenceValues = { ...initialProfileState(document).values };
  if (state.version === 2) {
    Object.assign(values, state.profile?.values ?? state.seed);
    for (const edit of state.outbox ?? []) {
      Object.assign(values, edit.set);
      for (const id of edit.unset ?? []) delete values[id];
    }
    return { version: 3, values: validValues(values) };
  }
  // The oldest shape: a selected profile (or local values) with per-profile overrides.
  const selected = state.selectedProfileId;
  Object.assign(values, selected ? state.profiles?.[selected]?.values : state.localValues);
  if (selected) Object.assign(values, state.overrides?.[selected]);
  return { version: 3, values: validValues(values) };
}
export function effectiveValues(state: DeviceProfileState): PreferenceValues {
  return { ...state.values };
}
export function resolveSetting(state: DeviceProfileState, id: string) {
  const d = definitionById.get(id);
  if (!d) throw new Error("Unknown setting");
  const value = state.values[id];
  return { value: value ?? d.default, source: value === undefined ? "default" : "device" };
}
export function editPreference(
  state: DeviceProfileState,
  id: string,
  value: PreferenceValue | undefined,
): DeviceProfileState {
  const d = definitionById.get(id);
  if (!d || (value !== undefined && !validPreference(d, value))) throw new Error("Invalid setting");
  if (state.values[id] === value) return state;
  const values = { ...state.values };
  if (value === undefined) delete values[id];
  else values[id] = value;
  return { ...state, values };
}
