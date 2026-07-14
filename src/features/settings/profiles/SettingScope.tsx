import { Button } from "@/shared/ui";
import { createContext, useContext } from "react";
import { resolveSetting } from "./model";
import { settingDefinitions, settingSearchEntries, type SettingOwnership } from "./registry";
import { useSettingsProfiles } from "./store";
export const SettingsPageScope = createContext<{
  page: string;
  owner: SettingOwnership;
} | null>(null);
export function SettingScope({ label }: { label: string }) {
  const page = useContext(SettingsPageScope);
  const store = useSettingsProfiles();
  if (!page) return null;
  const definition = settingDefinitions.find((d) => d.page === page.page && d.label === label);
  const owner =
    definition?.owner ??
    settingSearchEntries.find((d) => d.page === page.page && d.label === label)?.owner ??
    page.owner;
  if (owner !== "profile" || !definition)
    return (
      <span className="text-[11px] text-cream-muted">
        {owner === "account"
          ? "Account"
          : owner === "resource"
            ? "Resource settings"
            : "This device"}
      </span>
    );
  const state = store.state;
  if (!state || !store.ready)
    return <span className="text-[11px] text-cream-muted">Loading preference…</span>;
  const resolved = resolveSetting(state, definition.id);
  const name = state.selectedProfileId ? state.profiles[state.selectedProfileId]?.name : null;
  const title = resolved.source === "device" || !name ? "This device" : `Profile: ${name}`;
  return (
    <details className="text-[11px] text-cream-muted">
      <summary
        className="w-fit cursor-pointer rounded-sm focus-visible:outline"
        aria-label={`Storage for ${label}`}
      >
        {title}
      </summary>
      <div className="mt-2 flex flex-wrap gap-3">
        {name && resolved.source !== "device" && (
          <Button
            variant="link"
            type="button"
            className="h-auto p-0 text-[11px] underline underline-offset-2"
            onClick={() => void store.edit(definition.id, resolved.value, "device").catch(() => {})}
          >
            Only on this device
          </Button>
        )}
        {name && resolved.source === "device" && (
          <Button
            variant="link"
            type="button"
            className="h-auto p-0 text-[11px] underline underline-offset-2"
            onClick={() => void store.edit(definition.id, undefined, "device").catch(() => {})}
          >
            Use profile value
          </Button>
        )}
        <Button
          variant="link"
          type="button"
          className="h-auto p-0 text-[11px] underline underline-offset-2"
          onClick={() =>
            void store
              .edit(definition.id, undefined, resolved.source === "device" ? "device" : "profile")
              .catch(() => {})
          }
        >
          Reset preference
        </Button>
      </div>
    </details>
  );
}
