import type { WorkspaceView } from "@/features/workspace";
export function testTab(
  partial: Partial<WorkspaceView> & { id: string; title: string },
): WorkspaceView {
  return {
    surfaceId: "agents",
    groupKey: "tool:agents",
    instanceKey: partial.id,
    route: "/agents",
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
    ...partial,
  };
}
