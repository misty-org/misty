import { useAppsStore } from "@/features/apps";
import { NAVIGATOR_APP_IDS, type WorkspaceTab } from "@/features/workspace";

export function seedNavigatorApps() {
  useAppsStore.setState({
    accountId: "account-1",
    ready: true,
    catalog: [],
    installations: NAVIGATOR_APP_IDS.map((id, pin_rank) => ({
      app_id: id === "social" ? "chat" : id,
      state: "installed" as const,
      installed_version: "1.0.0",
      permission_version: 1,
      granted_scopes: [],
      pinned: true,
      pin_rank,
      installed_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })),
  });
}

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

export const spaceTab: WorkspaceTab = {
  id: "tab-1",
  surfaceId: "official-app",
  groupKey: "app:journal",
  instanceKey: "journal",
  title: "Journal",
  route: "/apps/journal?space=space-1&view=notes",
  sidebarVisible: true,
  state: {},
  createdAt: 1,
  lastFocusedAt: 1,
};

export const browserTab: WorkspaceTab = {
  id: "browser-tab",
  surfaceId: "official-app",
  groupKey: "app:browser",
  instanceKey: "browser",
  title: "Browser",
  route: "/apps/browser",
  sidebarVisible: true,
  state: { version: 1, url: "https://www.google.com", faviconUrl: null },
  createdAt: 2,
  lastFocusedAt: 2,
};
