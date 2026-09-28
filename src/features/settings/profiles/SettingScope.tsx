import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
} from "@/shared/ui";
import { MoreHorizontal } from "lucide-react";
import { createContext, useContext } from "react";
import { resolveSetting } from "./model";
import { settingDefinitions, settingSearchEntries, type SettingOwnership } from "./registry";
import { useSettingsProfiles } from "./store";
export const SettingsPageScope = createContext<{
  page: string;
  owner: SettingOwnership;
} | null>(null);
const ownerLabels: Record<Exclude<SettingOwnership, "profile">, string> = {
  account: "Account",
  device: "This device",
  resource: "Per item",
};
function useSettingScope(label: string) {
  const page = useContext(SettingsPageScope);
  const store = useSettingsProfiles();
  if (!page) return null;
  const definition = settingDefinitions.find((d) => d.page === page.page && d.label === label);
  const owner =
    definition?.owner ??
    settingSearchEntries.find((d) => d.page === page.page && d.label === label)?.owner ??
    page.owner;
  const state = store.ready && owner === "profile" && definition ? store.state : null;
  const resolved = state && definition ? resolveSetting(state, definition.id) : null;
  const profileName = state?.selectedProfileId
    ? state.profiles[state.selectedProfileId]?.name
    : undefined;
  return { page, owner, definition, store, resolved, profileName };
}
/** Where a whole page's settings are stored; shown once, next to the page title. */
export function SettingsScopePill({ owner }: { owner: SettingOwnership }) {
  const store = useSettingsProfiles();
  const selected = store.state?.selectedProfileId;
  const name = selected ? store.state?.profiles[selected]?.name : undefined;
  const text =
    owner !== "profile" ? ownerLabels[owner] : name ? `Profile: ${name}` : ownerLabels.device;
  return (
    <Badge variant="outline" className="font-normal text-cream-muted">
      {text}
    </Badge>
  );
}
/** Only rendered when a row is stored somewhere other than the rest of its page. */
export function SettingScopeBadge({ label }: { label: string }) {
  const scope = useSettingScope(label);
  if (!scope) return null;
  const overridden = Boolean(scope.profileName) && scope.resolved?.source === "device";
  const text =
    scope.owner !== scope.page.owner && scope.owner !== "profile"
      ? ownerLabels[scope.owner]
      : overridden
        ? ownerLabels.device
        : null;
  if (!text) return null;
  return (
    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal text-cream-muted">
      {text}
    </Badge>
  );
}
/** Reset and profile-override actions, revealed when the row is hovered or focused. */
export function SettingActionsMenu({ label }: { label: string }) {
  const scope = useSettingScope(label);
  if (!scope?.definition || !scope.resolved) return null;
  const { definition, resolved, store, profileName } = scope;
  const edit = (value: unknown, target: "device" | "profile") =>
    void store.edit(definition.id, value, target).catch(() => {});
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`Options for ${label}`}
          tooltip={false}
          size="xs"
          className="opacity-0 focus-visible:opacity-100 group-hover/setting-row:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {profileName && resolved.source !== "device" ? (
          <MenuItem
            label="Keep on this device only"
            onSelect={() => edit(resolved.value, "device")}
          />
        ) : null}
        {profileName && resolved.source === "device" ? (
          <MenuItem
            label={`Use ${profileName} value`}
            onSelect={() => edit(undefined, "device")}
          />
        ) : null}
        <MenuItem
          label="Reset to default"
          onSelect={() => edit(undefined, resolved.source === "device" ? "device" : "profile")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
