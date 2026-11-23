import { useEffect } from "react";
import { invoke } from "@/native";
import { useRegistryApps } from "./third_party_apps";
import { useSpaceApps } from "./use_space_apps";

export function useAppPrograms(spaceId: string | undefined) {
  const { apps } = useSpaceApps(spaceId ?? "");
  const listedApps = useRegistryApps();
  const key = (apps ?? [])
    .filter((app) => listedApps.some((entry) => entry.id === app.app_id && entry.mcp_program))
    .map((app) => `${app.app_id}@${app.version}`)
    .sort()
    .join(",");

  useEffect(() => {
    if (!key) return;
    const offered = key.split(",").map((pair) => {
      const at = pair.lastIndexOf("@");
      return { appId: pair.slice(0, at), version: pair.slice(at + 1) };
    });
    for (const { appId, version } of offered)
      invoke<number>("space_app_program_offer", { appId, version }).catch((error: unknown) =>
        console.warn(`${appId}'s tools aren't available to agents:`, error),
      );
    return () => {
      for (const { appId } of offered)
        void invoke("space_app_program_withdraw", { appId }).catch(() => {});
    };
  }, [key]);
}
