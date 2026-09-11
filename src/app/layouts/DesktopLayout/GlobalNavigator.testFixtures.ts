import type { WorkspaceView } from "@/features/workspace";

export function seedNavigatorApps() {}

export const spaceFixture = {
  id: "space-1",
  owner_user_id: "account-1",
  name: "Family",
  role: "owner" as const,
  member_count: 1,
  pending_count: 0,
  is_shared: true,
  is_default: false,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
};

export const spaceTab: WorkspaceView = {
  id: "tab-1",
  surfaceId: "space",
  groupKey: "space:space-1:journal",
  instanceKey: "journal",
  title: "Journal",
  route: "/spaces/space-1/notes",
  sidebarVisible: true,
  state: {},
  createdAt: 1,
  lastFocusedAt: 1,
};
