import { useEffect } from "react";
import { invoke } from "@/native";
import { useRegistryApps } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

/**
 * Offers agents the tools of the window Space's installed apps whose MCP server is their maker's own program
 * (`mcp: binary`, such as SoundCraft's `soundcraft-cli mcp`), with no tab of the app open. Native code reads which
 * program to run, from where and with which checksum, from its own copy of the catalog, downloads it the first
 * time and runs it confined to a chat's folder (`src-tauri/features/apps/program.rs`): this only names the app and
 * the version the Space installed. Apps that leave the list, or a Space the window switches away from, are
 * withdrawn.
 */
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
