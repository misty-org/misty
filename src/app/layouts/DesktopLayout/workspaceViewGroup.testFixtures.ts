import type { WorkspaceView } from "@/features/workspace";
export function testTab(
  partial: Partial<WorkspaceView> & { id: string; title: string },
): WorkspaceView {
  return {
    surfaceId: "files",
    groupKey: "tool:files",
    instanceKey: partial.id,
    route: "/files",
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
    ...partial,
  };
}
