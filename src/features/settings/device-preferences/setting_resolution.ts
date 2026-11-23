import {
  definitionById,
  portableValues,
  validPreference,
  type PreferenceValues,
  type PreferenceValue,
} from "./registry";
export interface DevicePreferencesState {
  version: 3;
  values: PreferenceValues;
}
export function initialPreferencesState(document: Record<string, unknown>): DevicePreferencesState {
  return { version: 3, values: portableValues(document) };
}
const validValues = (values: PreferenceValues): PreferenceValues =>
  Object.fromEntries(
    Object.entries(values).filter(([id, value]) => {
      const d = definitionById.get(id);
      return d && validPreference(d, value);
    }),
  );
export function migratePreferencesState(
  saved: unknown,
  document: Record<string, unknown>,
): DevicePreferencesState {
  if (!saved || typeof saved !== "object") return initialPreferencesState(document);
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
  const values: PreferenceValues = { ...initialPreferencesState(document).values };
  if (state.version === 2) {
    Object.assign(values, state.profile?.values ?? state.seed);
    for (const edit of state.outbox ?? []) {
      Object.assign(values, edit.set);
      for (const id of edit.unset ?? []) delete values[id];
    }
    return { version: 3, values: validValues(values) };
  }
  const selected = state.selectedProfileId;
  Object.assign(values, selected ? state.profiles?.[selected]?.values : state.localValues);
  if (selected) Object.assign(values, state.overrides?.[selected]);
  return { version: 3, values: validValues(values) };
}
export function effectiveValues(state: DevicePreferencesState): PreferenceValues {
  return { ...state.values };
}
export function resolveSetting(state: DevicePreferencesState, id: string) {
  const d = definitionById.get(id);
  if (!d) throw new Error("Unknown setting");
  const value = state.values[id];
  return { value: value ?? d.default, source: value === undefined ? "default" : "device" };
}
export function editPreference(
  state: DevicePreferencesState,
  id: string,
  value: PreferenceValue | undefined,
): DevicePreferencesState {
  const d = definitionById.get(id);
  if (!d || (value !== undefined && !validPreference(d, value))) throw new Error("Invalid setting");
  if (state.values[id] === value) return state;
  const values = { ...state.values };
  if (value === undefined) delete values[id];
  else values[id] = value;
  return { ...state, values };
}
