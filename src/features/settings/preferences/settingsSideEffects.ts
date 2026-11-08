import type { ShortcutsSnapshot } from "@/native/ipc";

// What the settings store (useSettingsStore.ts) applies outside itself when a document loads or
// changes. Features that react to a setting register an effect with `onSettingsApplied`; the app
// does it once at startup, so the store never imports the features it configures.

type SettingsEffect = (document: Record<string, unknown>, applyPortableLayout: boolean) => void;

const effects: SettingsEffect[] = [];

export function onSettingsApplied(effect: SettingsEffect): void {
  effects.push(effect);
}

export function currentShortcutOverrides(
  document: Record<string, unknown> | undefined,
  snapshot: ShortcutsSnapshot | null,
): ShortcutsSnapshot["overrides"] {
  const raw = (document?.shortcuts as Record<string, unknown> | undefined)?.overrides_json;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : (snapshot?.overrides ?? []);
    return Array.isArray(value) ? structuredClone(value) : [];
  } catch {
    return [];
  }
}

export function applySettingsSideEffects(
  document: Record<string, unknown>,
  applyPortableLayout = true,
): void {
  for (const effect of effects) effect(document, applyPortableLayout);
}
