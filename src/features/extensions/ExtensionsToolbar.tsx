import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Puzzle } from "lucide-react";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  toolbarIconProps,
} from "@/shared/ui";
import { useSettingsProfiles } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import { useBrowserOverlayControl } from "@/features/browser";
import { extensionsNative } from "./native";
import {
  parseInstallations,
  pinIds,
  reportExtensionError,
  setPreference,
  togglePin,
  useExtensionsStore,
} from "./store";
import type { ExtensionAction } from "./types";

export function ExtensionsToolbar({
  tabId,
  agentOwned = false,
}: {
  tabId: string;
  agentOwned?: boolean;
}) {
  const navigate = useNavigate();
  const profile = useSettingsProfiles((s) => s.state);
  const supported = useExtensionsStore((s) => s.supported);
  const revision = useExtensionsStore((s) => s.revision);
  const overlay = useBrowserOverlayControl(`browser-extensions:${tabId}`);
  const [actions, setActions] = useState<ExtensionAction[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [pinCapacity, setPinCapacity] = useState(0);
  useEffect(() => {
    const toolbar = container.current?.closest("[data-browser-toolbar]");
    if (!toolbar) return;
    const observer = new ResizeObserver(([entry]) =>
      setPinCapacity(Math.max(0, Math.min(4, Math.floor((entry.contentRect.width - 620) / 32)))),
    );
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const dragging = useRef<number | null>(null);
  const installed = parseInstallations(
    profile ? String(resolveSetting(profile, "extensions.installations").value) : "[]",
  ).filter((i) => i.installed);
  const expanded = profile
    ? Boolean(resolveSetting(profile, "extensions.pins_expanded").value)
    : true;
  const agentAccess = profile
    ? Boolean(resolveSetting(profile, "extensions.agent_access").value)
    : true;
  const pins = pinIds().filter((id) => installed.some((i) => i.id === id));
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
  function invoke(id: number, anchor: HTMLElement | null) {
    const bounds = (anchor ?? trigger.current)?.getBoundingClientRect();
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
  function reorder(id: number, target: number) {
    const next = pins.filter((pin) => pin !== id);
    next.splice(Math.max(0, target), 0, id);
    void setPreference("pins", JSON.stringify(next)).catch(reportExtensionError);
  }
  const usable = (id: number) =>
    actions.find((a) => Number(a.id) === id)?.enabled &&
    (!agentOwned || (agentAccess && installed.find((i) => i.id === id)?.agentAccess));
  return (
    <div ref={container} className="flex min-w-0 shrink-0 items-center">
      <div
        id={`extension-pins-${tabId}`}
        className={cn(
          "flex min-w-0 items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "max-w-44 opacity-100" : "max-w-0 opacity-0",
        )}
        inert={!expanded}
      >
        {pins.slice(0, pinCapacity).map((id, index) => {
          const action = actions.find((a) => Number(a.id) === id);
          const name = installed.find((i) => i.id === id)?.name ?? "Extension";
          return (
            <span
              key={id}
              draggable
              onDragStart={() => {
                dragging.current = id;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging.current !== null) reorder(dragging.current, index);
                dragging.current = null;
              }}
            >
              <IconButton
                label={action?.title || name}
                className="relative shrink-0"
                disabled={!usable(id)}
                onClick={(event) => invoke(id, event.currentTarget)}
                onKeyDown={(event) => {
                  if (
                    event.altKey &&
                    event.shiftKey &&
                    ["ArrowLeft", "ArrowRight"].includes(event.key)
                  ) {
                    event.preventDefault();
                    reorder(
                      id,
                      Math.min(
                        pins.length - 1,
                        Math.max(0, index + (event.key === "ArrowLeft" ? -1 : 1)),
                      ),
                    );
                  }
                }}
              >
                {action?.icon ? (
                  <img src={action.icon} alt="" className="size-4" />
                ) : (
                  <Puzzle {...toolbarIconProps} />
                )}
                {action?.badge && (
                  <span className="absolute bottom-0 right-0 max-w-5 truncate rounded-sm bg-cream px-0.5 text-[9px] leading-3 text-charcoal-bg">
                    {action.badge}
                  </span>
                )}
              </IconButton>
            </span>
          );
        })}
      </div>
      {pins.length > 0 && pinCapacity > 0 && (
        <IconButton
          label={expanded ? "Collapse pinned extensions" : "Expand pinned extensions"}
          aria-expanded={expanded}
          aria-controls={`extension-pins-${tabId}`}
          onClick={() => void setPreference("pins_expanded", !expanded).catch(reportExtensionError)}
        >
          {expanded ? (
            <ChevronRight {...toolbarIconProps} />
          ) : (
            <ChevronLeft {...toolbarIconProps} />
          )}
        </IconButton>
      )}
      <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
        <PopoverTrigger asChild>
          <IconButton ref={trigger} label="Extensions" tooltip={false}>
            <Puzzle {...toolbarIconProps} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-1">
          <p className="px-3 py-2 text-sm font-medium">Extensions</p>
          {!installed.length && (
            <p className="px-3 py-2 text-sm text-cream-muted">
              Install extensions to add tools to your browser.
            </p>
          )}
          <ul className="max-h-80 overflow-y-auto">
            {installed.map((item) => (
              <li key={item.id} className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start"
                  disabled={!usable(item.id)}
                  onClick={() => invoke(item.id, trigger.current)}
                >
                  {actions.find((a) => Number(a.id) === item.id)?.icon && (
                    <img
                      src={actions.find((a) => Number(a.id) === item.id)!.icon}
                      alt=""
                      className="size-4 shrink-0"
                    />
                  )}
                  <span className="truncate">
                    {actions.find((a) => Number(a.id) === item.id)?.title || item.name}
                  </span>
                  {actions.find((a) => Number(a.id) === item.id)?.badge && (
                    <span className="ml-auto text-xs text-cream-muted">
                      {actions.find((a) => Number(a.id) === item.id)?.badge}
                    </span>
                  )}
                </Button>
                <IconButton
                  label={`${pins.includes(item.id) ? "Unpin" : "Pin"} ${item.name}`}
                  aria-pressed={pins.includes(item.id)}
                  onKeyDown={(event) => {
                    if (
                      event.altKey &&
                      event.shiftKey &&
                      pins.includes(item.id) &&
                      ["ArrowLeft", "ArrowRight"].includes(event.key)
                    ) {
                      event.preventDefault();
                      reorder(
                        item.id,
                        Math.max(
                          0,
                          Math.min(
                            pins.length - 1,
                            pins.indexOf(item.id) + (event.key === "ArrowLeft" ? -1 : 1),
                          ),
                        ),
                      );
                    }
                  }}
                  onClick={() => void togglePin(item.id).catch(reportExtensionError)}
                >
                  {pins.includes(item.id) ? (
                    <Check size={16} />
                  ) : (
                    <span className="text-xs">Pin</span>
                  )}
                </IconButton>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            className="mt-1 w-full justify-start"
            onClick={() => {
              overlay.onOpenChange(false);
              navigate("/extensions/installed");
            }}
          >
            Manage extensions
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
