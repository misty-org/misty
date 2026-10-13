import { useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  toolbarIconProps,
} from "@/shared/ui";
import { useSettingsProfiles } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import { useBrowserOverlayControl } from "@/features/browser";
import { extensionsNative } from "./native";
import { openStorePage } from "./openStorePage";
import {
  parseInstallations,
  reportExtensionError,
  storeHomes,
  storeNames,
  updateInstallation,
  useExtensionsStore,
} from "./store";
import type { ExtensionAction, ExtensionStore } from "./types";

function openExtensionSettings() {
  window.dispatchEvent(
    new CustomEvent("misty:open-settings", { detail: { section: "browser-extensions" } }),
  );
}

/**
 * One toolbar button listing the installed extensions: each row runs that
 * extension's action and has its on/off switch. Extensions are added from
 * their stores' own sites.
 */
export function ExtensionsToolbar({
  tabId,
  agentOwned = false,
}: {
  tabId: string;
  agentOwned?: boolean;
}) {
  const profile = useSettingsProfiles((s) => s.state);
  const supported = useExtensionsStore((s) => s.supported);
  const revision = useExtensionsStore((s) => s.revision);
  const overlay = useBrowserOverlayControl(`browser-extensions:${tabId}`);
  const [actions, setActions] = useState<ExtensionAction[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const installed = parseInstallations(
    profile ? String(resolveSetting(profile, "extensions.installations").value) : "[]",
  ).filter((i) => i.installed);
  const agentAccess = profile
    ? Boolean(resolveSetting(profile, "extensions.agent_access").value)
    : true;
  useEffect(() => {
    if (!supported) return;
    let current = true;
    void extensionsNative
      .actions(tabId)
      .then(({ actions }) => {
        if (current) setActions(actions);
      })
      .catch(() => {
        if (current) setActions([]);
      });
    return () => {
      current = false;
    };
  }, [tabId, revision, supported, profile]);
  function invoke(id: string) {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    overlay.onOpenChange(false);
    requestAnimationFrame(() => {
      void extensionsNative
        .invoke(id, tabId, {
          x: bounds.x / window.innerWidth,
          y: bounds.y / window.innerHeight,
          width: bounds.width / window.innerWidth,
          height: bounds.height / window.innerHeight,
        })
        .catch(reportExtensionError);
    });
  }
  const usable = (id: string) =>
    actions.find((a) => a.id === id)?.enabled &&
    (!agentOwned || (agentAccess && installed.find((i) => i.id === id)?.agentAccess));
  return (
    <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton ref={trigger} label="Extensions" tooltip={false}>
          <Puzzle {...toolbarIconProps} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        {installed.length === 0 && (
          <p className="px-2 py-2 text-sm text-cream-muted">
            Add extensions from the Chrome Web Store or Firefox Add-ons.
          </p>
        )}
        <ul className="max-h-80 overflow-y-auto">
          {installed.map((item) => {
            const action = actions.find((a) => a.id === item.id);
            return (
              <li key={item.id} className="flex items-center gap-1 pr-2">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start"
                  disabled={!item.enabled || !usable(item.id)}
                  onClick={() => invoke(item.id)}
                >
                  {action?.icon ? (
                    <img src={action.icon} alt="" className="size-4 shrink-0" />
                  ) : (
                    <Puzzle size={16} aria-hidden="true" />
                  )}
                  {/* The extension's own name, as its store lists it; the button's
                      tooltip text is only a description. */}
                  <span className="truncate" title={action?.title || undefined}>
                    {item.name}
                  </span>
                </Button>
                <Switch
                  aria-label={`${item.name} on`}
                  checked={item.enabled}
                  onCheckedChange={(enabled) =>
                    void updateInstallation(item.id, { enabled }).catch(reportExtensionError)
                  }
                />
              </li>
            );
          })}
        </ul>
        {(["chrome", "firefox"] as ExtensionStore[]).map((store) => (
          <Button
            key={store}
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              overlay.onOpenChange(false);
              openStorePage(storeHomes[store]);
            }}
          >
            {storeNames[store]}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            overlay.onOpenChange(false);
            openExtensionSettings();
          }}
        >
          Manage extensions
        </Button>
      </PopoverContent>
    </Popover>
  );
}
