import type { WorkspaceView } from "@/features/workspace";
export function testTab(
  partial: Partial<WorkspaceView> & { id: string; title: string },
): WorkspaceView {
  return {
    surfaceId: "inbox",
    groupKey: "tool:inbox",
    instanceKey: partial.id,
    route: "/inbox",
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
    ...partial,
  };
}
