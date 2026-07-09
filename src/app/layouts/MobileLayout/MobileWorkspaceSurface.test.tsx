import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTab } from "@/features/workspace/model";
import { MobileWorkspaceSurface } from "./MobileWorkspaceSurface";
vi.mock("@/features/browser/workspace/BrowserWorkspace", () => ({
  BrowserWorkspace: ({ tab }: { tab: WorkspaceTab }) => (
    <div>Browser: {String((tab.state as { url?: string })?.url)}</div>
  ),
}));
vi.mock("@/features/files/workspace/mobile/MobileFilesPage", () => ({
  MobileFilesPage: () => <div>Local files</div>,
}));
vi.mock("@/features/agents/AgentsPage", () => ({ default: () => <div>Personal agents</div> }));
afterEach(cleanup);
describe("mobile browser workspace surfaces", () => {
  it.each([
    ["browser", "tool:browser", "Browser: https://www.google.com"],
    ["files", "tool:files", "Local files"],
    ["agents", "tool:agents", "Personal agents"],
    ["official-app", "app:files", "Local files"],
    ["space", "space:family", "Browser: https://www.google.com"],
    ["terminal", "tool:terminal", "Browser: https://www.google.com"],
  ] as const)(
    "renders %s / %s without an installation or desktop handoff",
    async (surfaceId, groupKey, content) => {
      const tab: WorkspaceTab = {
        id: "saved-tab",
        instanceKey: "saved-tab",
        surfaceId,
        groupKey,
        route: "/home",
        title: "Saved tab",
        sidebarVisible: false,
        state: {},
        createdAt: 1,
        lastFocusedAt: 1,
      };
      render(
        <MemoryRouter>
          <MobileWorkspaceSurface tab={tab} />
        </MemoryRouter>,
      );
      expect(await screen.findByText(content)).toBeTruthy();
    },
  );
});
