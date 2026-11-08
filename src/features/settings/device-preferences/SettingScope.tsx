import { createContext, useContext } from "react";
import { resolveSetting } from "./settingResolution";
import { settingDefinitions } from "./registry";
import type { SettingOwnership } from "./registry";
import { useDevicePreferences } from "./store";
import { preferenceSection } from "../settingsRouting";
export const SettingsPageScope = createContext<{ page: string; owner: SettingOwnership } | null>(
  null,
);
/** Reset for the row's setting, offered only while it differs from its default. */
export function useSettingReset(label: string): (() => void) | null {
  const page = useContext(SettingsPageScope);
  const store = useDevicePreferences();
  const definition = settingDefinitions.find(
    (d) => d.label === label && page !== null && preferenceSection(d.id, d.page) === page.page,
  );
  if (!definition || !store.ready || !store.state) return null;
  if (resolveSetting(store.state, definition.id).value === definition.default) return null;
  return () => void store.edit(definition.id, undefined, { stage: true }).catch(() => {});
}
