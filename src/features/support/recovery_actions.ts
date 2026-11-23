import { useAppRouteMemoryStore } from "@/app/shell";
import { useWorkspaceStore } from "@/features/app-windows";

export function recoverLastClosedWorkspaceTab(): boolean {
  return Boolean(useWorkspaceStore.getState().reopenClosedView());
}

export function resetWorkspaceLayout(): void {
  useWorkspaceStore.getState().reset();
  useAppRouteMemoryStore.getState().resetAppRoute();
}

export function reloadMisty(): void {
  window.location.reload();
}
