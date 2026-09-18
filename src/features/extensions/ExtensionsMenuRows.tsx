import { Puzzle } from "lucide-react";
import { MenuItem, MenuSubmenu } from "@/shared/ui";
import { rememberedExtensionIcon } from "./extensionIcons";
import { openStorePage } from "./openStorePage";
import { storeHomes, storeNames } from "./store";
import { useExtensionActions } from "./useExtensionActions";
import type { ExtensionStore } from "./types";

/** The installed extensions as a menu submenu: each row runs its extension's action. */
export function ExtensionsMenuRows({
  tabId,
  agentOwned = false,
  anchor,
}: {
  tabId: string;
  agentOwned?: boolean;
  /** Where an extension's popup opens from. */
  anchor: () => HTMLElement | null;
}) {
  const { installed, actions, usable, run } = useExtensionActions(tabId, agentOwned);
  return (
    <MenuSubmenu icon={<Puzzle />} label="Extensions" width="md">
      {installed.length === 0 ? (
        <MenuItem disabled label="No extensions installed" onSelect={() => {}} />
      ) : null}
      {installed.map((item) => {
        const icon =
          actions.find((a) => a.id === item.id)?.icon || rememberedExtensionIcon(item.id);
        return (
          <MenuItem
            key={item.id}
            icon={
              icon ? <img src={icon} alt="" className="size-4" /> : <Puzzle aria-hidden="true" />
            }
            label={item.name}
            disabled={!item.enabled || !usable(item.id)}
            onSelect={() => run(item.id, anchor())}
          />
        );
      })}
      {(["chrome", "firefox"] as ExtensionStore[]).map((store) => (
        <MenuItem
          key={store}
          label={storeNames[store]}
          onSelect={() => openStorePage(storeHomes[store])}
        />
      ))}
      <MenuItem
        label="Manage extensions"
        onSelect={() =>
          window.dispatchEvent(
            new CustomEvent("misty:open-settings", { detail: { section: "browser-extensions" } }),
          )
        }
      />
    </MenuSubmenu>
  );
}
