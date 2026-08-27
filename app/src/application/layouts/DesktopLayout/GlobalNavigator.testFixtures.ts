import type { WorkspaceTab } from "@/features/workspace";

export const spaceFixture = {
  id: "space-1",
  owner_user_id: "account-1",
  name: "Family",
  role: "owner" as const,
  member_count: 1,
  pending_count: 0,
  is_shared: true,
  created_at: "2026-08-17T00:00:00Z",
  updated_at: "2026-08-17T00:00:00Z",
};

export const spaceTab: WorkspaceTab = {
  id: "tab-1",
  surfaceId: "space",
  groupKey: "space:space-1",
  instanceKey: "space-1",
  title: "Family",
  route: "/spaces/space-1/notes",
  sidebarVisible: true,
  state: {},
  createdAt: 1,
  lastFocusedAt: 1,
};

export const browserTab: WorkspaceTab = {
  id: "browser-tab",
  surfaceId: "browser",
  groupKey: "tool:browser",
  instanceKey: "browser-tab",
  title: "Browser",
  route: "/browser",
  sidebarVisible: true,
  state: { version: 1, url: "https://www.google.com", faviconUrl: null },
  createdAt: 2,
  lastFocusedAt: 2,
};
