import { Button } from "@/shared/ui";
import { createContext, useContext } from "react";
import { settingDefinitions, type SettingOwnership } from "./registry";
import { useSettingsProfiles } from "./store";
export const SettingsPageScope = createContext<{ page: string; owner: SettingOwnership } | null>(
  null,
);
export function SettingActionsMenu({ label }: { label: string }) {
  const page = useContext(SettingsPageScope);
  const store = useSettingsProfiles();
  const definition = settingDefinitions.find(
    (d) =>
      d.label === label &&
      (d.page === page?.page ||
        (page?.page === "sync" && d.id.startsWith("browser.privacy.page_state"))),
  );
  if (!definition || !store.ready) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Reset ${label} to default`}
      disabled={store.syncing}
      onClick={() => void store.edit(definition.id, undefined).catch(() => {})}
    >
      Reset
    </Button>
  );
}
