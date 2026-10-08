import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Puzzle } from "lucide-react";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toolbarIconProps,
} from "@/shared/ui";
import { useSettingsProfiles } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import { useBrowserOverlayControl } from "@/features/browser";
import { extensionsNative } from "./native";
import { parseInstallations, reportExtensionError, useExtensionsStore } from "./store";
import type { ExtensionAction } from "./types";

/** One toolbar button listing the installed extensions; each row runs that extension's action. */
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
  function invoke(id: number) {
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
  const usable = (id: number) =>
    actions.find((a) => Number(a.id) === id)?.enabled &&
    (!agentOwned || (agentAccess && installed.find((i) => i.id === id)?.agentAccess));
  return (
    <Popover open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton ref={trigger} label="Extensions" tooltip={false}>
          <Puzzle {...toolbarIconProps} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <ul className="max-h-80 overflow-y-auto">
          {installed.map((item) => {
            const action = actions.find((a) => Number(a.id) === item.id);
            return (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  className="w-full min-w-0 justify-start"
                  disabled={!usable(item.id)}
                  onClick={() => invoke(item.id)}
                >
                  {action?.icon ? (
                    <img src={action.icon} alt="" className="size-4 shrink-0" />
                  ) : (
                    <Puzzle size={16} aria-hidden="true" />
                  )}
                  <span className="truncate">{action?.title || item.name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            overlay.onOpenChange(false);
            navigate("/extensions/installed");
          }}
        >
          Manage extensions
        </Button>
      </PopoverContent>
    </Popover>
  );
}
