import { useEffect, useState } from "react";
import { useSettingsProfiles } from "@/features/settings";
import { resolveSetting } from "@/features/settings";
import { extensionsNative } from "./native";
import { rememberExtensionIcons } from "./extensionIcons";
import { parseInstallations, reportExtensionError, useExtensionsStore } from "./store";
import type { ExtensionAction } from "./types";

/**
 * The installed extensions and their live toolbar actions for one browser tab, shared by the
 * toolbar popover and the sidebar's menu. `run` opens an extension's popup under `anchor`.
 */
export function useExtensionActions(tabId: string, agentOwned: boolean) {
  const profile = useSettingsProfiles((s) => s.state);
  const supported = useExtensionsStore((s) => s.supported);
  const revision = useExtensionsStore((s) => s.revision);
  const [actions, setActions] = useState<ExtensionAction[]>([]);
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
        if (current) {
          rememberExtensionIcons(actions);
          setActions(actions);
        }
      })
      .catch(() => {
        if (current) setActions([]);
      });
    return () => {
      current = false;
    };
  }, [tabId, revision, supported, profile]);
  const usable = (id: string) =>
    Boolean(
      actions.find((a) => a.id === id)?.enabled &&
      (!agentOwned || (agentAccess && installed.find((i) => i.id === id)?.agentAccess)),
    );
  function run(id: string, anchor: HTMLElement | null, beforeRun?: () => void) {
    const bounds = anchor?.getBoundingClientRect();
    if (!bounds) return;
    beforeRun?.();
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
  return { installed, actions, usable, run };
}
