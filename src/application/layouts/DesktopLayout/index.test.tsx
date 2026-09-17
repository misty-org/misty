import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: mocks.user,
    refreshUser: vi.fn().mockResolvedValue(mocks.user),
  }),
}));

vi.mock("@/features/spaces", () => ({
  useSpacesStore: (selector: (state: { spaces: unknown[]; snapshotReady: boolean }) => unknown) =>
    selector({ spaces: [], snapshotReady: true }),
  preferredDefaultSpace: () => null,
  canonicalSpaceRoute: (id: string) => `/spaces/${id}`,
  defaultSpaceRoute: () => "/spaces",
  rememberedJournalRoute: () => "/spaces/journal",
  rememberedPlannerRoute: () => "/spaces/planner",
  socialProviderPath: () => "/spaces/social",
}));

vi.mock("@/features/workspace", () => ({
  useWorkspaceStore: (selector: (state: {
    canNavigatePane: (delta: number) => boolean;
    navigatePane: (delta: number) => { route: string } | null;
    openSurface: () => void;
  }) => unknown) =>
    selector({
      canNavigatePane: () => false,
      navigatePane: () => null,
      openSurface: vi.fn(),
    }),
  workspaceSurfaceFromRoute: () => null,
  findDockLeaf: () => null,
}));

vi.mock("./GlobalNavigator", () => ({
  GlobalNavigator: () => <div data-testid="global-navigator">Global Navigator</div>,
}));

vi.mock("./WorkspaceCanvas", () => ({
  WorkspaceCanvas: () => <div data-testid="workspace-canvas">Workspace Canvas</div>,
}));

vi.mock("./useDesktopWindowChrome", () => ({
  useDesktopWindowChrome: () => ({
    usesNativeWindowChrome: true,
    shouldShowWindowsTitlebarControls: false,
    isWindowMaximized: false,
    startTitlebarDrag: vi.fn(),
    handleDesktopTitlebarPointerDown: vi.fn(),
    toggleTitlebarMaximize: vi.fn(),
    minimizeTitlebarWindow: vi.fn(),
    closeTitlebarWindow: vi.fn(),
  }),
}));

vi.mock("./useDesktopBootstrap", () => ({
  useDesktopBootstrap: () => {
    const location = useLocation();
    return {
      location,
      navigate: vi.fn(),
      app: null,
      settingsLoad: vi.fn(),
      activePaneId: "",
      activePanePath: "",
      activeWorkspacePaneId: "",
      lastAppRoute: "/spaces",
      lastNonSettingsRouteRef: { current: "/spaces" },
      routeId: location.pathname.slice(1),
    };
  },
}));

vi.mock("./useDesktopShellStatus", () => ({
  useDesktopShellStatus: () => false,
}));

vi.mock("./useDesktopFrameStyle", () => ({
  useDesktopFrameStyle: () => ({ app: null }),
}));

vi.mock("@/features/shortcuts", () => ({
  useShortcutTitle: (label: string) => label,
  useShortcutHandler: vi.fn(),
  registerShortcutHandler: vi.fn(() => () => undefined),
}));

vi.mock("@/features/navigation-names/NavigationNamesBoundary", () => ({
  NavigationNamesBoundary: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));

vi.mock("@/features/tour", () => ({
  AppTour: () => null,
  isTourCompletedForAccount: () => true,
  useTourStore: {
    getState: () => ({ isOpen: false, startTour: vi.fn() }),
  },
}));

vi.mock("./ProfilePopover", () => ({ ProfilePopover: () => null }));
vi.mock("./SettingsOverlays", () => ({ RemotesOverlay: () => null, SettingsOverlay: () => null }));
vi.mock("./TransferStatus", () => ({
  WorkStatusPopup: () => null,
  TransferCompletionNotifier: () => null,
}));
vi.mock("./FramePacingOverlay", () => ({ FramePacingOverlay: () => null }));
vi.mock("@/features/global-search", () => ({
  GlobalMisty: () => null,
  BrowserContextMenuBridge: () => null,
}));
vi.mock("@/features/browser", () => ({
  BrowserRuntimeBridge: () => null,
  setBrowserWebviewsSuspended: vi.fn(),
}));
vi.mock("@/features/files/explorer", () => ({ MediaSearchViewer: () => null }));
vi.mock("@/features/spaces/SpacesRealtimeBridge", () => ({ SpacesRealtimeBridge: () => null }));
vi.mock("@/features/activity", () => ({ ActivityBridge: () => null }));
vi.mock("@/features/agents/AgentJobWorker", () => ({ AgentJobWorker: () => null }));

import { DesktopLayout } from "./index";

describe("DesktopLayout on Auth Routes", () => {
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
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("suppresses the sidebar navigator and renders Outlet directly on /signin", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <Routes>
            <Route
              element={<DesktopLayout getRouteId={() => "signin" as any} navItems={[]} />}
            >
              <Route path="/signin" element={<div data-testid="auth-outlet">Sign In Screen</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="auth-outlet"]')).not.toBeNull();
    // Sidebar navigator must be suppressed completely
    expect(container.querySelector('[data-testid="global-navigator"]')).toBeNull();
    // Workspace canvas must be suppressed
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBeNull();
    // No history back/forward buttons
    expect(container.querySelector('button[aria-label="Go back"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Go forward"]')).toBeNull();
  });

  it("suppresses the sidebar navigator and renders Outlet directly on /register", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/register"]}>
          <Routes>
            <Route
              element={<DesktopLayout getRouteId={() => "register" as any} navItems={[]} />}
            >
              <Route path="/register" element={<div data-testid="auth-outlet">Register Screen</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="auth-outlet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="global-navigator"]')).toBeNull();
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBeNull();
  });
});
