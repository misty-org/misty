import type * as DeploymentApi from "@/api/deployment/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  resumeAccount: vi.fn(),
  titlebarPointerDown: vi.fn(),
}));

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: mocks.user,
    refreshUser: vi.fn().mockResolvedValue(mocks.user),
  }),
}));

vi.mock("@/features/workspace", () => ({
  useWindowDockingLayout: () => ({ navigation: "left", tabs: "top" }),
  useWorkspaceStore: (selector: (state: { openSurface: () => void }) => unknown) =>
    selector({
      openSurface: vi.fn(),
    }),
  workspaceSurfaceFromRoute: () => null,
  findDockLeaf: () => null,
}));

vi.mock("./GlobalNavigator", () => ({
  GlobalNavigator: () => <div data-testid="global-navigator">Global Navigator</div>,
}));

vi.mock("./WorkspaceCanvas", () => ({
  WorkspaceCanvas: (props: { titlebarInsets?: { left: number } }) => (
    <div data-testid="workspace-canvas" data-tab-inset={props.titlebarInsets?.left}>
      Workspace Canvas
    </div>
  ),
}));

vi.mock("./useDesktopWindowChrome", () => ({
  useDesktopWindowChrome: () => ({
    shouldShowWindowsTitlebarControls: false,
    isWindowMaximized: false,
    startTitlebarDrag: vi.fn(),
    handleDesktopTitlebarPointerDown: mocks.titlebarPointerDown,
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
      lastAppRoute: "/browser",
      lastNonSettingsRouteRef: { current: "/browser" },
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

vi.mock("@/api/deployment/api", async (importOriginal) => ({
  ...(await importOriginal<typeof DeploymentApi>()),
  resolveApiBase: async () => "https://api.example.test/v1",
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    user: mocks.user,
    accounts: [{ id: "saved-account", name: "Test Account", email: "test@example.test" }],
    transitioning: false,
    resumeAccount: mocks.resumeAccount,
  }),
}));

vi.mock("@/features/tour", () => ({
  AppTour: () => null,
  isTourCompletedForAccount: () => true,
  useTourStore: {
    getState: () => ({ isOpen: false, startTour: vi.fn() }),
  },
}));

vi.mock("./ProfileMenu", () => ({ ProfileMenu: () => null }));
vi.mock("./SettingsOverlays", () => ({ RemotesOverlay: () => null, SettingsOverlay: () => null }));
vi.mock("./FramePacingOverlay", () => ({ FramePacingOverlay: () => null }));
vi.mock("@/features/global-search", () => ({
  GlobalMisty: () => null,
}));
vi.mock("@/features/browser/workspace", () => ({
  BrowserRuntimeBridge: () => null,
  setBrowserWebviewsSuspended: vi.fn(),
}));
vi.mock("@/features/webviews/BrowserRuntimeBridge", () => ({ BrowserRuntimeBridge: () => null }));
vi.mock("@/features/browser-workspace/BrowserSearchDialog", () => ({
  BrowserSearchDialog: () => null,
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: vi.fn(),
  setBrowserPointerTrackingEnabled: vi.fn(),
}));
vi.mock("@/features/global-search/BrowserContextMenuBridge", () => ({
  BrowserContextMenuBridge: () => null,
}));
vi.mock("@/features/files/workspace/explorer", () => ({ MediaSearchViewer: () => null }));
vi.mock("@/features/activity", () => ({ ActivityBridge: () => null }));
vi.mock("@/features/scheduled", () => ({ ScheduledTasksBridge: () => null }));
vi.mock("@/features/agents/AgentJobWorker", () => ({ AgentJobWorker: () => null }));

import { SavedAccountSessionUnavailableError } from "@/features/auth/sessionErrors";
import SignIn from "@/features/auth/SignInPage";
import { notifyAccountScopeReset } from "@/features/auth/store/accountEvents";
import { useNavigationNames } from "@/features/navigation-names/store";
import { useSettingsStore } from "@/features/settings";
import { DesktopLayout } from "./index";
import { navigatorLayoutStorageKey, publishNavigatorLayout } from "./navigatorMode";

describe("DesktopLayout on Auth Routes", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem(navigatorLayoutStorageKey);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.user = null;
    vi.clearAllMocks();
    vi.spyOn(useSettingsStore.getState(), "updateSetting").mockImplementation(() => {});
    useNavigationNames.setState({ account: "", ready: false, names: {}, error: null });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it.each([
    [
      new SavedAccountSessionUnavailableError(),
      "Your saved sign-in for test@example.test is no longer available",
    ],
    [new Error("Connection interrupted"), "Could not resume this account. Connection interrupted"],
  ])("keeps the picker mounted during account resets and displays %s", async (error, message) => {
    let rejectResume!: (error: Error) => void;
    mocks.resumeAccount.mockImplementationOnce(() => {
      notifyAccountScopeReset();
      return new Promise<void>((_resolve, reject) => {
        rejectResume = reject;
      });
    });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <Routes>
            <Route element={<DesktopLayout getRouteId={() => "signin" as any} />}>
              <Route path="/signin" element={<SignIn />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("test@example.test"))!
        .click();
    });
    expect(container.textContent).toContain("Signing in…");
    await act(async () => rejectResume(error));
    expect(container.textContent).toContain(message);
    if (error instanceof SavedAccountSessionUnavailableError) {
      expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
        "test@example.test",
      );
      expect(container.querySelector('input[type="password"]')).not.toBeNull();
    }
  });

  it("opens the workspace after a saved account resumes across a scope reset", async () => {
    let resolveResume!: () => void;
    mocks.resumeAccount.mockImplementationOnce(() => {
      notifyAccountScopeReset();
      return new Promise<void>((resolve) => {
        resolveResume = resolve;
      });
    });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <Routes>
            <Route element={<DesktopLayout getRouteId={() => "signin" as any} />}>
              <Route path="/signin" element={<SignIn />} />
            </Route>
            <Route path="/browser" element={<div>Account workspace</div>} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("test@example.test"))!
        .click();
    });
    expect(container.textContent).toContain("Signing in…");
    await act(async () => {
      mocks.user = { id: "saved-account", email: "test@example.test" };
      resolveResume();
    });
    expect(container.textContent).toBe("Account workspace");
    expect(mocks.resumeAccount).toHaveBeenCalledOnce();
  });

  it.each([
    ["/browser", "true", "1 / 4"],
    ["/activity", "false", "1 / 4"],
    ["/signin", "false", "2"],
  ])("reserves native chrome correctly on %s", async (route, sharedTabs, row) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <DesktopLayout getRouteId={() => "browser"} />
        </MemoryRouter>,
      );
    });
    expect(
      container.querySelector(".misty-docking-titlebar")?.getAttribute("data-shared-tabs"),
    ).toBe(sharedTabs);
    expect((container.querySelector("[data-misty-route-shell]") as HTMLElement).style.gridRow).toBe(
      row,
    );
  });

  it("reserves native window controls when Layout settings hides the rail", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/browser"]}>
          <DesktopLayout getRouteId={() => "browser"} />
        </MemoryRouter>,
      ),
    );
    const frame = container.querySelector<HTMLElement>("[data-misty-desktop-frame]")!;
    const before = frame.style.gridTemplateColumns;
    const dragRegion = container.querySelector<HTMLElement>(".misty-docking-titlebar-drag-region")!;
    expect(dragRegion.style.width).toBe(before.split(" ")[0]);
    await act(async () => publishNavigatorLayout({ autoHide: true }));
    expect(frame.style.gridTemplateColumns).not.toBe(before);
    expect(Number.parseFloat(dragRegion.style.width)).toBeGreaterThan(56);
    await act(async () => {
      dragRegion.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    });
    expect(mocks.titlebarPointerDown).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="workspace-canvas"]')?.getAttribute("data-tab-inset"),
    ).toBe(dragRegion.style.width.replace("px", ""));
    expect(container.querySelector('button[aria-label="Go back"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Go forward"]')).toBeNull();
  });

  it("keeps the workspace mounted when navigation visibility changes from settings", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/browser"]}>
          <DesktopLayout getRouteId={() => "browser"} />
        </MemoryRouter>,
      ),
    );
    const frame = container.querySelector<HTMLElement>("[data-misty-desktop-frame]")!;
    const canvas = container.querySelector<HTMLElement>('[data-testid="workspace-canvas"]')!;
    const originalColumns = frame.style.gridTemplateColumns;
    const originalInset = canvas.dataset.tabInset;
    await act(async () => publishNavigatorLayout({ autoHide: true }));
    expect(frame.style.gridTemplateColumns).toBe("0px minmax(0, 1fr) 0px");
    expect(container.querySelector('[aria-label="Auto-hide navigation"]')).toBeNull();
    expect(container.querySelector(".misty-docking-nav")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBe(canvas);
    // Both changing lengths must use the same timeline; an instant grid jump
    // followed by animated padding sends the tabs underneath the window controls.
    expect(frame.className).toContain("transition-[grid-template-columns,grid-template-rows]");
    await act(async () => publishNavigatorLayout({ autoHide: false }));
    expect(frame.style.gridTemplateColumns).toBe(originalColumns);
    expect(canvas.dataset.tabInset).toBe(originalInset);
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBe(canvas);
  });

  it("suppresses the sidebar navigator and renders Outlet directly on /signin", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <Routes>
            <Route element={<DesktopLayout getRouteId={() => "signin" as any} />}>
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
            <Route element={<DesktopLayout getRouteId={() => "register" as any} />}>
              <Route
                path="/register"
                element={<div data-testid="auth-outlet">Register Screen</div>}
              />
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
