import { act } from "react";
import type * as DeploymentApi from "@/api/deployment/api";
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
    usesNativeWindowChrome: true,
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
vi.mock("@/features/browser/workspace", () => ({
  BrowserRuntimeBridge: () => null,
  setBrowserWebviewsSuspended: vi.fn(),
}));
vi.mock("@/features/webviews/BrowserRuntimeBridge", () => ({ BrowserRuntimeBridge: () => null }));
vi.mock("@/features/browser-workspace/BrowserSearchDialog", () => ({
  BrowserSearchDialog: () => null,
}));
vi.mock("@/features/webviews/browserRuntime", () => ({ setBrowserWebviewsSuspended: vi.fn() }));
vi.mock("@/features/global-search/BrowserContextMenuBridge", () => ({
  BrowserContextMenuBridge: () => null,
}));
vi.mock("@/features/files/workspace/explorer", () => ({ MediaSearchViewer: () => null }));
vi.mock("@/features/activity", () => ({ ActivityBridge: () => null }));
vi.mock("@/features/agents/AgentJobWorker", () => ({ AgentJobWorker: () => null }));

import { DesktopLayout } from "./index";
import SignIn from "@/features/auth/SignInPage";
import { SavedAccountSessionUnavailableError } from "@/features/auth/sessionErrors";
import { notifyAccountScopeReset } from "@/features/auth/store/accountEvents";
import { useNavigationNames } from "@/features/navigation-names/store";

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
    useNavigationNames.setState({ account: "", ready: false, names: {}, error: null });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
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
            <Route element={<DesktopLayout getRouteId={() => "signin" as any} navItems={[]} />}>
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
            <Route element={<DesktopLayout getRouteId={() => "signin" as any} navItems={[]} />}>
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
    ["/browser", "true", "1 / -1"],
    ["/activity", "false", "2"],
    ["/signin", "false", "2"],
  ])("reserves native chrome correctly on %s", async (route, sharedTabs, row) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <DesktopLayout getRouteId={() => "browser"} navItems={[]} />
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

  it("anchors tabs to the content while resizing without shell history buttons", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/browser"]}>
          <DesktopLayout getRouteId={() => "browser"} navItems={[]} />
        </MemoryRouter>,
      ),
    );
    const frame = container.querySelector<HTMLElement>("[data-misty-desktop-frame]")!;
    const before = frame.style.gridTemplateColumns;
    const dragRegion = container.querySelector<HTMLElement>(".misty-docking-titlebar-drag-region")!;
    expect(dragRegion.style.width).toBe(before.split(" ")[0]);
    const handle = container.querySelector('[role="separator"]')!;
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(frame.style.gridTemplateColumns).not.toBe(before);
    expect(dragRegion.style.width).toBe(frame.style.gridTemplateColumns.split(" ")[0]);
    await act(async () => {
      dragRegion.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    });
    expect(mocks.titlebarPointerDown).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="workspace-canvas"]')?.getAttribute("data-tab-inset"),
    ).toBe("0");
    expect(container.querySelector('button[aria-label="Go back"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Go forward"]')).toBeNull();
  });

  it("keeps the workspace mounted and reserves titlebar space when navigation is toggled", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/browser"]}>
          <DesktopLayout getRouteId={() => "browser"} navItems={[]} />
        </MemoryRouter>,
      ),
    );
    const frame = container.querySelector<HTMLElement>("[data-misty-desktop-frame]")!;
    const canvas = container.querySelector<HTMLElement>('[data-testid="workspace-canvas"]')!;
    const originalColumns = frame.style.gridTemplateColumns;
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Hide navigation"]')!.click(),
    );
    expect(frame.style.gridTemplateColumns).toBe("0px minmax(0, 1fr)");
    expect(Number(canvas.dataset.tabInset)).toBeGreaterThan(16);
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBe(canvas);
    // Both changing lengths must use the same timeline; an instant grid jump
    // followed by animated padding sends the tabs underneath the window controls.
    expect(frame.className).toContain("transition-[grid-template-columns,grid-template-rows]");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Show navigation"]')!.click(),
    );
    expect(frame.style.gridTemplateColumns).toBe(originalColumns);
    expect(canvas.dataset.tabInset).toBe("0");
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBe(canvas);
  });

  it("suppresses the sidebar navigator and renders Outlet directly on /signin", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <Routes>
            <Route element={<DesktopLayout getRouteId={() => "signin" as any} navItems={[]} />}>
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
            <Route element={<DesktopLayout getRouteId={() => "register" as any} navItems={[]} />}>
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
