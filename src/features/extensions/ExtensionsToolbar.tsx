import { useRef } from "react";
import { Pin, PinOff, Puzzle } from "lucide-react";
import {
  Button,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  toolbarIconProps,
} from "@/shared/ui";
import { useBrowserOverlayControl } from "@/features/browser";
import { rememberedExtensionIcon } from "./extensionIcons";
import { useExtensionActions } from "./useExtensionActions";
import { openStorePage } from "./openStorePage";
import {
  offeredStores,
  reportExtensionError,
  storeHomes,
  storeNames,
  updateInstallation,
} from "./store";
import { PinnedExtensionButton } from "./PinnedExtensionButton";

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
  pinnedOnly = false,
}: {
  tabId: string;
  agentOwned?: boolean;
  /** Only the pinned extensions' buttons, without the listing popover. */
  pinnedOnly?: boolean;
}) {
  const overlay = useBrowserOverlayControl(`browser-extensions:${tabId}`);
  const trigger = useRef<HTMLButtonElement>(null);
  const { installed, actions, usable, run } = useExtensionActions(tabId, agentOwned);
  const invoke = (id: string, anchor: HTMLElement | null = trigger.current) =>
    run(id, anchor, () => overlay.onOpenChange(false));
  return (
    <>
      {installed
        .filter((item) => item.pinned)
        .map((item) => {
          const action = actions.find((a) => a.id === item.id);
          return (
            <PinnedExtensionButton
              key={item.id}
              item={item}
              action={action}
              icon={action?.icon || rememberedExtensionIcon(item.id)}
              usable={usable(item.id)}
              onInvoke={invoke}
            />
          );
        })}
      {/* With nothing installed there is nothing to list: no button (Settings manages them). */}
      {pinnedOnly || installed.length === 0 ? null : (
        <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
          <PopoverTrigger asChild>
            <IconButton ref={trigger} label="Extensions" tooltip={false}>
              <Puzzle {...toolbarIconProps} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1">
            <ul className="max-h-80 overflow-y-auto">
              {installed.map((item) => {
                const action = actions.find((a) => a.id === item.id);
                const icon = action?.icon || rememberedExtensionIcon(item.id);
                return (
                  <li key={item.id} className="flex items-center gap-1 pr-2">
                    <Button
                      variant="ghost"
                      className="min-w-0 flex-1 justify-start"
                      disabled={!item.enabled || !usable(item.id)}
                      onClick={() => invoke(item.id)}
                    >
                      {icon ? (
                        // Off means gray, not a different icon.
                        <img
                          src={icon}
                          alt=""
                          className={cn("size-4 shrink-0", !item.enabled && "grayscale")}
                        />
                      ) : (
                        <Puzzle size={16} aria-hidden="true" />
                      )}
                      {/* The extension's own name, as its store lists it; the button's
                      tooltip text is only a description. */}
                      <span className="truncate" title={action?.title || undefined}>
                        {item.name}
                      </span>
                    </Button>
                    <IconButton
                      label={item.pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
                      size="xs"
                      onClick={() =>
                        void updateInstallation(item.id, { pinned: !item.pinned }).catch(
                          reportExtensionError,
                        )
                      }
                    >
                      {item.pinned ? (
                        <PinOff size={16} aria-hidden="true" />
                      ) : (
                        <Pin size={16} aria-hidden="true" />
                      )}
                    </IconButton>
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
            {offeredStores.map((store) => (
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
      )}
    </>
  );
}
