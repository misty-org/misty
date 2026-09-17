import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  needsOnboarding: false,
  transitioning: false,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: mocks.user,
    transitioning: mocks.transitioning,
    accounts: mocks.user ? [{ id: mocks.user.id, email: mocks.user.email, name: "Test" }] : [],
  }),
}));

vi.mock("@/features/onboarding/onboardingState", () => ({
  accountNeedsOnboarding: () => mocks.needsOnboarding,
}));

vi.mock("@/features/spaces", () => ({
  useSpacesStore: (selector: (state: { spaces: unknown[]; snapshotReady: boolean }) => unknown) =>
    selector({ spaces: [], snapshotReady: true }),
}));

vi.mock("@/features/spaces/defaultSpace", () => ({
  preferredDefaultSpace: () => null,
}));

vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: (selector: (state: { activeScopeKey: string }) => unknown) =>
    selector({ activeScopeKey: "" }),
}));

vi.mock("@/features/apps", () => ({
  useAppsStore: {
    getState: () => ({
      selectAccount: vi.fn(),
      reset: vi.fn(),
      invalidate: vi.fn(),
      load: vi.fn(),
      spaceId: "",
      accountId: "",
      error: null,
      installations: [],
    }),
  },
}));

vi.mock("@/native/settings-plugins", () => ({
  configurePluginSpaceAuthority: vi.fn(),
}));

vi.mock("@/application/platform-layout", () => ({
  default: () => <div data-testid="platform-layout">Platform Layout Content</div>,
}));

vi.mock("@/features/agents/AgentExecutionSurface", () => ({ AgentExecutionSurface: () => null }));

vi.mock("@/features/activity/ActivityPanel", () => ({
  ActivityPanel: () => <div data-testid="activity-panel" />,
}));

vi.mock("@/features/onboarding/OnboardingFlow", () => ({
  OnboardingFlow: () => <div data-testid="onboarding-flow" />,
}));

vi.mock("@/features/updater/UpdateNotices", () => ({
  UpdateNotices: () => <div data-testid="update-notices" />,
}));

vi.mock("@/features/connected-devices", () => ({
  ConnectedDevicesProvider: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));

import { AppFrameLayout } from "./AppFrameLayout";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      <span data-testid="location-state">{JSON.stringify(location.state)}</span>
    </div>
  );
}

describe("AppFrameLayout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.user = null;
    mocks.needsOnboarding = false;
    mocks.transitioning = false;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks unauthenticated users and redirects /spaces to /signin with target state", async () => {
    mocks.user = null;

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces?tab=overview"]}>
          <Routes>
            <Route path="/signin" element={<LocationProbe />} />
            <Route element={<AppFrameLayout />}>
              <Route path="/spaces" element={<div>Spaces content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toContain(
      "/signin",
    );
    expect(container.querySelector('[data-testid="location-state"]')?.textContent).toContain(
      "/spaces?tab=overview",
    );
    expect(container.textContent).not.toContain("Spaces content");
    expect(container.querySelector('[data-testid="platform-layout"]')).toBeNull();
  });

  it("keeps the route and hook order stable while an account transition restores identity", async () => {
    mocks.transitioning = true;
    const view = () => (
      <MemoryRouter initialEntries={["/spaces"]}>
        <Routes>
          <Route path="/signin" element={<LocationProbe />} />
          <Route element={<AppFrameLayout />}>
            <Route path="/spaces" element={<div>Spaces content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await act(async () => {
      root.render(view());
    });
    expect(container.querySelector('[data-testid="location-probe"]')).toBeNull();
    expect(container.querySelector('[data-testid="platform-layout"]')).toBeNull();
    const loading = container.querySelector('[role="status"][aria-label="Restoring account"]');
    expect(loading?.textContent).toBe("");
    expect(loading?.classList.contains("bg-black")).toBe(true);
    mocks.user = { id: "user-1", email: "user@example.com" };
    await act(async () => {
      root.render(view());
    });
    expect(container.querySelector('[data-testid="platform-layout"]')).toBeNull();
    mocks.transitioning = false;
    await act(async () => {
      root.render(view());
    });
    expect(container.querySelector('[data-testid="platform-layout"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="location-probe"]')).toBeNull();
  });

  it("allows unauthenticated access to /signin without redirection and isolates auth route", async () => {
    mocks.user = null;

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <Routes>
            <Route element={<AppFrameLayout />}>
              <Route path="/signin" element={<div>Sign In Screen</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    // Renders PlatformLayout (for the auth route)
    expect(container.querySelector('[data-testid="platform-layout"]')).not.toBeNull();
    // Does NOT render background app panels
    expect(container.querySelector('[data-testid="activity-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="update-notices"]')).toBeNull();
    expect(container.querySelector('[data-testid="onboarding-flow"]')).toBeNull();
  });

  it("allows unauthenticated access to /register without redirection and isolates auth route", async () => {
    mocks.user = null;

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/register"]}>
          <Routes>
            <Route element={<AppFrameLayout />}>
              <Route path="/register" element={<div>Register Screen</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="platform-layout"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="activity-panel"]')).toBeNull();
  });

  it("allows unauthenticated access to /invite/:token", async () => {
    mocks.user = null;

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/invite/token-123"]}>
          <Routes>
            <Route path="/signin" element={<LocationProbe />} />
            <Route element={<AppFrameLayout />}>
              <Route path="/invite/:token" element={<div>Invite Preview</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="location-probe"]')).toBeNull();
    expect(container.querySelector('[data-testid="platform-layout"]')).not.toBeNull();
  });

  it("renders full app frame with services when user is authenticated", async () => {
    mocks.user = { id: "user-1", email: "user@example.com" };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces"]}>
          <Routes>
            <Route element={<AppFrameLayout />}>
              <Route path="/spaces" element={<div>Spaces Page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="platform-layout"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="activity-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="update-notices"]')).not.toBeNull();
  });
});
