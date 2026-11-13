import "@/app/featureSeams";
import type * as DeploymentApi from "@/api/deployment/api";
import type * as AgentsModule from "@/features/agents";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  resumeAccount: vi.fn(),
  titlebarPointerDown: vi.fn(),
}));

vi.mock("@/features/account", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: mocks.user,
    refreshUser: vi.fn().mockResolvedValue(mocks.user),
  }),
  openSignInSheet: vi.fn(),
  openSignOutSheet: vi.fn(),
  SignInSheet: () => null,
  SignOutSheet: () => null,
  AccountClosingNotice: () => null,
  AccountSuspendedNotice: () => null,
}));

vi.mock("@/features/app-windows", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWindowDockingLayout: () => ({ navigation: "right", tabs: "left" }),
  useWorkspaceStore: (selector: (state: { openSurface: () => void }) => unknown) =>
    selector({
      openSurface: vi.fn(),
    }),
  workspaceSurfaceFromRoute: () => null,
  findDockLeaf: () => null,
  MistyBrandIcon: () => <span />,
}));

vi.mock("./AccountIsland", () => ({ AccountIsland: () => null, AccountTab: () => null }));
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
      lastAppRoute: "/agents",
      lastNonSettingsRouteRef: { current: "/agents" },
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

vi.mock("@/features/shortcuts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShortcutHandler: vi.fn(),
  registerShortcutHandler: vi.fn(() => () => undefined),
}));

vi.mock("@/api/deployment/api", async (importOriginal) => ({
  ...(await importOriginal<typeof DeploymentApi>()),
  resolveApiBase: async () => "https://api.example.test/v1",
}));

vi.mock("@/features/account/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: mocks.user,
    accounts: [{ id: "saved-account", name: "Test Account", email: "test@example.test" }],
    transitioning: false,
    resumeAccount: mocks.resumeAccount,
  }),
}));

vi.mock("./AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("./SettingsOverlays", () => ({ RemotesOverlay: () => null, SettingsOverlay: () => null }));
vi.mock("./FramePacingOverlay", () => ({ FramePacingOverlay: () => null }));
vi.mock("@/features/browser/webviews/BrowserRuntimeBridge", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserRuntimeBridge: () => null,
}));
vi.mock("@/features/app-windows/page-runtime/browserOverlayRuntime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setBrowserWebviewsSuspended: vi.fn(),
}));
vi.mock(
  "@/features/agents/conversations/context/BrowserContextMenuBridge",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    BrowserContextMenuBridge: () => null,
  }),
);
vi.mock("@/features/agents/runs/jobs/AgentJobWorker", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AgentJobWorker: () => null,
}));
vi.mock("@/features/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentsModule>();
  return {
    ...actual,
    MistyPanel: () => <div data-testid="misty-panel" />,
  };
});

import { SavedAccountSessionUnavailableError } from "@/features/account/sessions/sessionErrors";
import SignIn from "@/features/account/pages/SignInPage";
import { notifyAccountScopeReset } from "@/features/account/sessions/accountEvents";
import { useSettingsStore } from "@/features/settings";
import { useMistyPanelStore } from "@/features/agents";
import { NoticeViewport } from "@/shared/ui";
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
    vi.spyOn(useSettingsStore.getState(), "updateSetting").mockImplementation(() => {});
    useMistyPanelStore.setState({ chatOpen: false });
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
        <>
          {/* App mounts the notices' viewport; errors show there. */}
          <NoticeViewport />
          <MemoryRouter initialEntries={["/signin"]}>
            <Routes>
              <Route element={<DesktopLayout getRouteId={() => "signin" as any} />}>
                <Route path="/signin" element={<SignIn />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </>,
      );
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("test@example.test"))!
        .click();
    });
    expect(container.textContent).toContain("Signing in…");
    await act(async () => rejectResume(error));
    // Errors show as a notification, which renders in the page-level viewport.
    expect(document.body.textContent).toContain(message);
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
            <Route path="/agents" element={<div>Account workspace</div>} />
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
    ["/agents", "1 / 4"],
    ["/invite/token", "1 / 4"],
    ["/signin", "2"],
  ])("reserves native chrome correctly on %s", async (route, row) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <DesktopLayout getRouteId={() => "agents"} />
        </MemoryRouter>,
      );
    });
    expect((container.querySelector("[data-misty-route-shell]") as HTMLElement).style.gridRow).toBe(
      row,
    );
  });

  it("gives no room to a navigation rail: the tab strip carries its buttons", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/agents"]}>
          <DesktopLayout getRouteId={() => "agents"} />
        </MemoryRouter>,
      ),
    );
    const frame = container.querySelector<HTMLElement>("[data-misty-desktop-frame]")!;
    expect(frame.style.gridTemplateColumns).toBe("0px minmax(0, 1fr) 0px");
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
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBeNull();
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
    expect(container.querySelector('[data-testid="workspace-canvas"]')).toBeNull();
  });
});
