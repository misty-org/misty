import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Space, SpaceInvitation } from "@/models/interfaces/features/spaces/types";
import { spacesTabsSessionKey, useSpacesTabsStore } from "@/stores/spaces/useSpacesTabsStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import SpacesShell from "@/features/spaces/components/SpacesShell";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-1" }, transitioning: false }),
}));
vi.mock("@/features/spaces/components/SpacePanelContent", () => ({
  SpacePanelContent: () => <div>Space panel</div>,
}));
vi.mock("@/features/spaces/components/SpacesWorkspaceSurface", () => ({
  SpacesWorkspaceSurface: ({ tab }: { tab: { kind: string } }) => <div>{tab.kind}</div>,
}));
vi.mock("@/features/spaces/spacesShell/CreateSpaceDialog", () => ({
  CreateSpaceDialog: () => null,
}));
vi.mock("@/features/spaces/spacesShell/SpaceInvitationsNotice", () => ({
  SpaceInvitationsNotice: () => null,
}));
vi.mock("@/features/agents/AgentDock", () => ({ AgentDock: () => null }));

describe("SpacesShell workspace tabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useSpacesTabsStore.setState({ sessions: {} });
    useSpacesStore.setState({
      spaces: [spaceFixture()],
      invitations: [],
      snapshotReady: true,
      referenceOnly: false,
      loading: false,
      error: null,
      load: vi.fn(async () => undefined),
      setViewingSpace: vi.fn(),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useSpacesTabsStore.setState({ sessions: {} });
    useSpacesStore.setState({ spaces: [] });
    container.remove();
  });

  it("opens File Manager without creating a duplicate Space tab", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/notes"]}>
          <Routes>
            <Route path="/spaces/:spaceId/*" element={<SpacesShell />}>
              <Route path="*" element={<div>Space content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".misty-transient-scrollbar.mb-3")).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open File Manager"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-1")];
    expect(session.tabs.map((tab) => tab.kind)).toEqual(["space", "file-manager"]);
    expect(session.tabs.find((tab) => tab.id === session.activeTabId)?.kind).toBe("file-manager");
  });

  it("mounts the Misty redirect whenever no Space is selected", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces"]}>
          <Routes>
            <Route path="/spaces" element={<SpacesShell />}>
              <Route index element={<div>Opening default Misty Space</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Opening default Misty Space");
  });

  it("opens Agents as a new active workspace tab", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/notes"]}>
          <Routes>
            <Route path="/spaces/:spaceId/*" element={<SpacesShell />}>
              <Route path="*" element={<div>Space content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open Agents"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const session =
      useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account-1", "space-1")];
    expect(session.tabs.map((tab) => tab.kind)).toEqual(["space", "agents"]);
    expect(session.tabs.find((tab) => tab.id === session.activeTabId)?.kind).toBe("agents");
  });

  it("keeps invited Space content locked until acceptance", async () => {
    useSpacesStore.setState({
      spaces: [spaceFixture()],
      invitations: [invitationFixture()],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/family-space/invitation"]}>
          <Routes>
            <Route path="/spaces/:spaceId/*" element={<SpacesShell />}>
              <Route path="*" element={<div>Private Space content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="Family invitation"]')).not.toBeNull();
    expect(container.textContent).toContain("Accept invitation");
    expect(container.textContent).not.toContain("Private Space content");
    expect(useSpacesTabsStore.getState().sessions).toEqual({});
  });

  it("replaces every Space surface with reconnect status while offline", async () => {
    useSpacesStore.setState({ referenceOnly: true, loading: false });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/notes"]}>
          <Routes>
            <Route path="/spaces/:spaceId/*" element={<SpacesShell />}>
              <Route path="*" element={<div>Private Space content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Trying to reconnect to Misty");
    expect(container.textContent).not.toContain("Private Space content");
    expect(container.querySelector('[aria-label="Open File Manager"]')).toBeNull();
  });
});

function spaceFixture(): Space {
  return {
    id: "space-1",
    owner_user_id: "account-1",
    name: "Design team",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: true,
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
  };
}

function invitationFixture(): SpaceInvitation {
  return {
    id: "invite-1",
    space_id: "family-space",
    space_name: "Family",
    invited_email: "person@example.com",
    invited_by_user_id: "owner-2",
    inviter_name: "Chen",
    delivery_status: "sent",
    expires_at: "2026-08-12T00:00:00Z",
    created_at: "2026-08-05T00:00:00Z",
  };
}
