import { appsApi } from "@/api/apps";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { officialDesktopPackageReady } from "@/features/apps/desktopPackages";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";

export function currentMistySpace(): string {
  return useAppsStore.getState().spaceId || "";
}

export async function assertMistyAvailable(accountId: string, spaceId: string): Promise<void> {
  if (!accountId || !spaceId) throw new Error("Select a Space with Agents enabled to use Misty.");
  const state = useAppsStore.getState();
  if (state.accountId !== accountId)
    throw new Error("The Misty account changed. Open Misty again.");
  const result = await appsApi.installations(spaceId);
  if (useAppsStore.getState().accountId !== accountId)
    throw new Error("The Misty account changed.");
  if (!result.apps.some((app) => app.app_id === "agents" && app.state === "installed"))
    throw new Error("Enable Agents in this Space to use Misty. Open Discover to manage its apps.");
  if (hasTauriInternals() && !isNativeMobileBuild) {
    const app = useAppsStore.getState().catalog.find((app) => app.id === "agents");
    if (!app || !(await officialDesktopPackageReady(app)))
      throw new Error("Install the Agents package on this device to use Misty.");
  }
  if (useAppsStore.getState().accountId !== accountId)
    throw new Error("The Misty account changed.");
}
