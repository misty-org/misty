import { createContext, useContext } from "react";
import { resolveSetting } from "./model";
import { settingDefinitions } from "./registry";
import type { SettingOwnership } from "./registry";
import { useSettingsProfiles } from "./store";
export const SettingsPageScope = createContext<{ page: string; owner: SettingOwnership } | null>(
  null,
);
/** Reset for the row's account setting, offered only while it differs from its default. */
export function useSettingReset(label: string): (() => void) | null {
  const page = useContext(SettingsPageScope);
  const store = useSettingsProfiles();
  const definition = settingDefinitions.find(
    (d) =>
      d.label === label &&
      (d.page === page?.page ||
        (page?.page === "sync" && d.id.startsWith("browser.privacy.page_state"))),
  );
  if (!definition || !store.ready || !store.state) return null;
  if (resolveSetting(store.state, definition.id).value === definition.default) return null;
  return () => void store.edit(definition.id, undefined).catch(() => {});
}
