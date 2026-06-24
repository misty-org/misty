import { useAppDownloads } from "./useAppDownloads";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { OfficialApp } from "@/api/apps";
import { useAppsStore } from "./useAppsStore";
import { useAppConsent } from "./useAppConsent";
import { OfficialAppRuntimePage } from "./OfficialAppRuntimePage";

const mocks = vi.hoisted(() => ({
  download: vi.fn().mockResolvedValue(undefined),
  session: vi.fn().mockResolvedValue({ expires_at: new Date(Date.now() + 120_000).toISOString() }),
  load: vi.fn().mockResolvedValue(undefined),
  spaces: [{ id: "family", name: "Family", role: "member" }],
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "member" } }) }));
vi.mock("@/api/apps", () => ({ appsApi: { createSession: mocks.session } }));
vi.mock("@/api/client", () => ({ resolveRequiredApiBase: async () => "https://api.test" }));
vi.mock("./desktop-package-runtime", () => ({
  officialDesktopPackageReady: async () => false,
  installOfficialDesktopPackage: mocks.download,
}));
vi.mock("@/features/agents/AgentsPage", () => ({ default: () => <div>Agents</div> }));
vi.mock("./MiniAppRuntime", () => ({ MiniAppRuntime: () => <div>App running</div> }));
vi.mock("./DownloadedAppSurface", () => ({ DownloadedAppSurface: () => <div>App running</div> }));
vi.mock("./TrustedAppSurface", () => ({ TrustedAppSurface: () => <div>App running</div> }));
vi.mock("@/features/spaces/core", () => ({
  preferredDefaultSpace: () => mocks.spaces[0],
  useSpacesStore: Object.assign(
    (select: (state: unknown) => unknown) => select({ spaces: mocks.spaces }),
    { getState: () => ({ spaces: mocks.spaces }) },
  ),
}));
const app = {
  description: "Test app",
  official: true,
  age_rating: "4+",
  id: "test-app",
  name: "Test app",
  publisher: "Misty",
  version: "1",
  permission_version: 1,
  scopes: [],
  minimum_host_protocol: 1,
  desktop: { runtime: "downloaded" },
  mobile: { runtime: "hosted" },
} as OfficialApp;
beforeEach(() => {
  useAppDownloads.setState({ removed: {}, ready: {} });
  useAppConsent.setState({ agreed: {} });
  useAppsStore.setState({
    accountId: "member",
    ready: true,
    catalog: [app],
    error: "",
    load: mocks.load,
    installations: [
        {
          app_id: app.id,
          state: "installed",
          installed_version: "1",
          permission_version: 1,
          granted_scopes: [],
          authority_generation: 1,
        },
      ] as never,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function RouteLocation() {
  const location = useLocation();
  return (
    <output data-testid="route">
      {location.pathname}
      {location.search}
    </output>
  );
}
it("does not download or start a Space-enabled app until this member agrees", async () => {
  // Another member's agreement must not unlock the current member's runtime.
  useAppConsent.getState().agree("owner", app);
  render(
    <MemoryRouter>
      <OfficialAppRuntimePage appId={app.id} spaceId="family" />
      <RouteLocation />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
  expect(screen.getByTestId("route").textContent).toBe("/discover?app=test-app&review=permissions");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.download).not.toHaveBeenCalled();
  act(() => useAppConsent.getState().agree("member", app));
  await waitFor(() => expect(mocks.session).toHaveBeenCalledExactlyOnceWith(app.id, undefined, 1));
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(app);
  expect(await screen.findByText("App running")).toBeTruthy();
});

it("does not automatically download a locally removed app even with consent and Space access", () => {
  useAppConsent.getState().agree("member", app);
  useAppDownloads.setState({ removed: { [app.id]: true } });
  render(
    <MemoryRouter>
      <OfficialAppRuntimePage appId={app.id} spaceId="family" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Get app" })).toBeTruthy();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
});

it("shows the native download error instead of hiding string rejections", async () => {
  useAppConsent.getState().agree("member", app);
  mocks.download.mockRejectedValueOnce("App download failed: HTTP status 404");
  render(
    <MemoryRouter>
      <OfficialAppRuntimePage appId={app.id} spaceId="family" />
    </MemoryRouter>,
  );
  expect(await screen.findByText("App download failed: HTTP status 404")).toBeTruthy();
});

it("does not retry a failed session when catalog and installation objects are refreshed", async () => {
  mocks.session.mockRejectedValue(new Error("Rate limited"));
  useAppConsent.getState().agree("member", app);
  render(
    <MemoryRouter>
      <OfficialAppRuntimePage appId={app.id} spaceId="family" />
    </MemoryRouter>,
  );
  await screen.findByText("Rate limited");
  for (let n = 0; n < 10; n++) {
    await act(async () =>
      useAppsStore.setState((state) => ({
        catalog: structuredClone(state.catalog),
        installations: structuredClone(state.installations),
      })),
    );
  }
  expect(mocks.session).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(mocks.session).toHaveBeenCalledTimes(2));
  mocks.session.mockResolvedValue({ expires_at: new Date(Date.now() + 120_000).toISOString() });
});

it("rejects malformed expiry instead of scheduling immediate session refreshes", async () => {
  mocks.session.mockResolvedValue({ expires_at: "invalid" });
  useAppConsent.getState().agree("member", app);
  render(
    <MemoryRouter>
      <OfficialAppRuntimePage appId={app.id} spaceId="family" />
    </MemoryRouter>,
  );
  await screen.findByText("The server returned an expired app session. Try again.");
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("App running")).toBeNull();
  mocks.session.mockResolvedValue({ expires_at: new Date(Date.now() + 120_000).toISOString() });
});

function installPersonalApp(
  id: "files" | "browser",
  runtime: OfficialApp["desktop"]["runtime"] = "downloaded",
) {
  const personalApp = {
    ...app,
    id,
    app_id: `com.misty.${id}`,
    name: id === "files" ? "Files" : "Browser",
    desktop: { runtime, entry: "https://apps.test/app.zip" },
  } as OfficialApp;
  useAppsStore.setState({
    catalog: [personalApp],
    installations: [
        {
          ...useAppsStore.getState().installations[0],
          app_id: id,
        },
      ],
  });
  useAppConsent.getState().agree("member", personalApp);
  return personalApp;
}

it.each(["files", "browser"] as const)(
  "waits for the %s download before starting its app session",
  async (id) => {
    const personalApp = installPersonalApp(id);
    let finish!: () => void;
    mocks.download.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MemoryRouter>
        <OfficialAppRuntimePage appId={id} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(personalApp));
    expect(mocks.session).not.toHaveBeenCalled();
    expect(screen.queryByText("App running")).toBeNull();
    await act(async () => finish());
    expect(await screen.findByText("App running")).toBeTruthy();
  },
);

it.each(["files", "browser"] as const)(
  "does not reinstall removed %s just because its global shortcut is opened",
  (id) => {
    installPersonalApp(id);
    useAppDownloads.setState({ removed: { [id]: true } });
    render(
      <MemoryRouter>
        <OfficialAppRuntimePage appId={id} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Get app" })).toBeTruthy();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  },
);

it.each([
  ["files", "embedded"],
  ["browser", "embedded"],
  ["files", "hosted"],
  ["browser", "hosted"],
] as const)("rejects the %s %s desktop fallback", (id, runtime) => {
  installPersonalApp(id, runtime);
  render(
    <MemoryRouter>
      <OfficialAppRuntimePage appId={id} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Get the downloadable .* package from Discover/)).toBeTruthy();
  expect(screen.queryByText("App running")).toBeNull();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
});
