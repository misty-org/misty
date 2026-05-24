import { useAppRouteMemoryStore } from "@/features/app-shell";
import { useWorkspaceStore } from "@/features/workspace";

export function recoverLastClosedWorkspaceTab(): boolean {
  return Boolean(useWorkspaceStore.getState().reopenClosedTab());
}

export function resetWorkspaceLayout(): void {
  useWorkspaceStore.getState().reset();
  useAppRouteMemoryStore.getState().resetAppRoute();
}

export function reloadMisty(): void {
  window.location.reload();
}
