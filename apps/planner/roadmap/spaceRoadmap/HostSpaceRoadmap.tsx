import { useCallback, useMemo, type ReactNode } from "react";
import { commandsForApp } from "@misty/sdk";
import { spacesApi } from "@/api/spaces/api";
import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { useAuth } from "@/features/auth";
import { useAppThemeStore, useSettingsStore } from "@/features/settings";
import { SystemErrorActivity } from "@/features/activity";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useWorkspaceTabFocused, useWorkspaceTabTitle } from "@/features/workspace";
import {
  registerShortcutHandler,
  effectiveShortcut,
  formatShortcutLabel,
  detectShortcutPlatform,
} from "@/features/shortcuts";
import { SpaceRoadmapView } from "../SpaceRoadmapView";
import { RoadmapRuntimeProvider, type RoadmapRuntime } from "./roadmapRuntime";

const storage: RoadmapRuntime["storage"] = {
  getItem: readDeploymentStorageItem,
  setItem: (key, value) => window.localStorage.setItem(deploymentStorageKey(key), value),
};
export function HostRoadmapRuntimeProvider(props: {
  spaceId: string;
  workspaceTabId?: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const focused = useWorkspaceTabFocused();
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  const settings = useSettingsStore((state) => state.settings?.document);
  const shortcutLabels = useMemo(
    () =>
      Object.fromEntries(
        commandsForApp("planner").map((command) => [
          command,
          formatShortcutLabel(effectiveShortcut(command).primary, detectShortcutPlatform()),
        ]),
      ),
    [settings],
  );
  const subscribeChanges = useCallback(
    (listener: () => void) => {
      const receive = (event: Event) => {
        if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === props.spaceId)
          listener();
      };
      window.addEventListener("misty:space-roadmap-event", receive);
      return () => window.removeEventListener("misty:space-roadmap-event", receive);
    },
    [props.spaceId],
  );
  return (
    <RoadmapRuntimeProvider
      runtime={{
        api: spacesApi,
        userId: user?.id,
        focused,
        theme,
        storage,
        shortcutLabels,
        subscribeChanges,
        registerCommand: registerShortcutHandler,
        renderIntegration: (input) => (
          <HostRoadmapIntegration {...input} workspaceTabId={props.workspaceTabId} />
        ),
        renderError: (error) => (
          <SystemErrorActivity
            error={error}
            scope="planner:roadmap"
            title="Roadmap needs attention"
          />
        ),
      }}
    >
      {props.children}
    </RoadmapRuntimeProvider>
  );
}
export function HostSpaceRoadmap(props: {
  spaceId: string;
  roadmapId: string;
  canManage: boolean;
  workspaceTabId?: string;
}) {
  return (
    <HostRoadmapRuntimeProvider spaceId={props.spaceId} workspaceTabId={props.workspaceTabId}>
      <SpaceRoadmapView {...props} />
    </HostRoadmapRuntimeProvider>
  );
}
function HostRoadmapIntegration(
  props: Parameters<RoadmapRuntime["renderIntegration"]>[0] & { workspaceTabId?: string },
) {
  useAiSurfaceAdapter(props.adapter);
  useWorkspaceTabTitle(props.workspaceTabId, props.title);
  return null;
}
