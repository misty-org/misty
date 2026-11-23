import { useEffect } from "react";
import { LocalToolRejected, registerLocalTools, unregisterLocalTools } from "@/features/agents";
import type { LocalToolHandler } from "@/features/agents";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/app-windows";
import { invoke } from "@/native";
import { runningApp, useRunningAppIds } from "./app_screen";
import { appRoute } from "./app_routes";
import { createScreenTools } from "./app_screen_tools";
import { appToolName } from "./app_tools";
import { appEntry, runsHere } from "./third_party_apps";
import { useSpaceApps } from "./use_space_apps";

const OPEN_WAIT_MS = 45_000;

function untilRunning(appId: string): Promise<boolean> {
  if (runningApp(appId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stop();
      resolve(false);
    }, OPEN_WAIT_MS);
    const stop = useRunningAppIds.subscribe((state) => {
      if (!state.ids.includes(appId)) return;
      window.clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}

export function useAppStandby(spaceId: string | undefined) {
  const { apps } = useSpaceApps(spaceId ?? "");
  const runningIds = useRunningAppIds((state) => state.ids);
  const key = (apps ?? [])
    .flatMap((app) => {
      const entry = appEntry(app);
      if (!entry || !runsHere(entry) || runningIds.includes(app.app_id)) return [];
      return [`${app.app_id}\t${entry.name}`];
    })
    .sort()
    .join("\n");

  useEffect(() => {
    if (!spaceId || !key) return;
    const offered = key.split("\n").map((line) => {
      const [appId, appName] = line.split("\t");
      return { appId, appName };
    });
    const names: string[] = [];
    for (const { appId, appName } of offered) {
      const { definitions } = createScreenTools({
        appId,
        appName,
        screen: { command: () => Promise.reject(new Error("closed")), dispose: () => {} },
        frame: () => null,
      });
      const standby = definitions.map((definition) => ({
        ...definition,
        description: `${definition.description} ${appName} isn't open yet: the first call opens it in the person's window.`,
        annotations: { readOnlyHint: false },
      }));
      const handlers: Record<string, LocalToolHandler> = {};
      for (const definition of standby) {
        const name = appToolName(appId, definition.name);
        handlers[name] = async () => {
          if (!runningApp(appId)) {
            const surface = workspaceSurfaceFromRoute(appRoute(spaceId, appId));
            if (surface) useWorkspaceStore.getState().openSurface(surface);
          }
          if (!(await untilRunning(appId)))
            throw new LocalToolRejected(
              "app_not_started",
              `${appName} didn't start. Ask the person to open it.`,
            );
          return {
            opened: appName,
            note: `${appName} is open in the person's window now and its tools are ready. Call ${definition.name} again to act.`,
          };
        };
        names.push(name);
      }
      registerLocalTools(handlers);
      void invoke<number>("space_app_tools_standby", { appId, tools: standby }).catch(() => {});
    }
    return () => {
      unregisterLocalTools(names);
      for (const { appId } of offered)
        void invoke("space_app_tools_withdraw", { appId }).catch(() => {});
    };
  }, [spaceId, key]);
}
