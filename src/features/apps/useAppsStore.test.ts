import { beforeEach, expect, it, vi } from "vitest";
import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { useAppsStore } from "./useAppsStore";
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  installations: vi.fn(),
  install: vi.fn(),
  setPinned: vi.fn(),
  uninstall: vi.fn(),
  ready: vi.fn(),
  stage: vi.fn(),
  finalize: vi.fn(),
  remove: vi.fn(),
  generation: 0,
}));
vi.mock("@/api/apps", () => ({
  appsApi: {
    catalog: mocks.catalog,
    installations: mocks.installations,
    install: mocks.install,
    setPinned: mocks.setPinned,
    uninstall: mocks.uninstall,
  },
}));
vi.mock("@/api/client", () => ({
  readApiSessionGeneration: () => mocks.generation,
  assertStableApiSession: (value: number) => {
    if (value !== mocks.generation) throw new Error("account changed");
  },
}));
vi.mock("@/shared/platform/buildTarget", () => ({ isNativeMobileBuild: false, isWebBuild: false }));
vi.mock("./desktop-package-runtime", () => ({
  officialDesktopPackageReady: mocks.ready,
  stageOfficialDesktopPackage: mocks.stage,
  finalizeOfficialDesktopPackageInstall: mocks.finalize,
  uninstallOfficialDesktopPackage: mocks.remove,
}));
const app = {
  id: "planner",
  name: "Planner",
  permission_version: 4,
  desktop: { runtime: "downloaded" },
} as OfficialApp;
const installation = {
  app_id: "planner",
  state: "installed",
  pinned: true,
  pin_rank: 1,
} as UserAppInstallation;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const switchAccount = (accountId = "account-b") => {
  mocks.generation++;
  useAppsStore.getState().reset();
  useAppsStore.setState({ accountId, ready: true });
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 0;
  useAppsStore.getState().reset();
  useAppsStore.setState({ accountId: "account-a", ready: true });
  mocks.ready.mockResolvedValue(false);
  mocks.stage.mockResolvedValue("operation-a");
  mocks.finalize.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.install.mockResolvedValue(installation);
  mocks.uninstall.mockResolvedValue({ ...installation, state: "recoverable" });
  mocks.setPinned.mockResolvedValue(installation);
});

it("rolls back a staged download when the account changes before server installation", async () => {
  const staged = deferred<string>();
  mocks.stage.mockReturnValue(staged.promise);
  const pending = useAppsStore.getState().install(app);
  const rejected = expect(pending).rejects.toThrow(/account changed/);
  await vi.waitFor(() => expect(mocks.stage).toHaveBeenCalledOnce());
  switchAccount();
  staged.resolve("operation-a");
  await rejected;
  expect(mocks.install).not.toHaveBeenCalled();
  expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("planner", "operation-a", false);
  expect(useAppsStore.getState()).toMatchObject({
    accountId: "account-b",
    installations: [],
    error: "",
    actionAppId: "",
  });
});

it("does not publish an installation returned after switching away and back to the same account", async () => {
  const installed = deferred<UserAppInstallation>();
  mocks.install.mockReturnValue(installed.promise);
  const pending = useAppsStore.getState().install(app);
  const rejected = expect(pending).rejects.toThrow(/account changed/);
  await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledOnce());
  switchAccount();
  switchAccount("account-a");
  installed.resolve(installation);
  await rejected;
  expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("planner", "operation-a", false);
  expect(useAppsStore.getState().installations).toEqual([]);
});

it("retains server installation truth if local activation fails, allowing download repair", async () => {
  mocks.finalize.mockImplementation(async (_id, _operation, commit) => {
    if (commit) throw new Error("activation failed");
  });
  await expect(useAppsStore.getState().install(app)).rejects.toThrow("activation failed");
  expect(useAppsStore.getState()).toMatchObject({
    installations: [installation],
    error: "activation failed",
    actionAppId: "",
  });
  expect(mocks.finalize).toHaveBeenLastCalledWith("planner", "operation-a", false);
});

it("does not remove shared package files or mutate the next account after an old uninstall returns", async () => {
  const removed = deferred<UserAppInstallation>();
  mocks.uninstall.mockReturnValue(removed.promise);
  const pending = useAppsStore.getState().uninstall("planner");
  const rejected = expect(pending).rejects.toThrow(/account changed/);
  switchAccount();
  removed.resolve({ ...installation, state: "recoverable" });
  await rejected;
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(useAppsStore.getState()).toMatchObject({ installations: [], error: "" });
});

it("loads a new account even while the old account's catalog request is outstanding", async () => {
  const oldCatalog = deferred<{ apps: OfficialApp[] }>();
  mocks.catalog.mockReturnValueOnce(oldCatalog.promise).mockResolvedValueOnce({ apps: [app] });
  mocks.installations
    .mockResolvedValueOnce({ apps: [] })
    .mockResolvedValueOnce({ apps: [installation] });
  const old = useAppsStore.getState().load("account-a", true);
  mocks.generation++;
  await useAppsStore.getState().load("account-b");
  oldCatalog.resolve({ apps: [] });
  await old;
  expect(useAppsStore.getState()).toMatchObject({
    accountId: "account-b",
    ready: true,
    loading: false,
    catalog: [app],
    installations: [installation],
  });
});

it("rejects overlapping App mutations while preserving the first operation", async () => {
  const installed = deferred<UserAppInstallation>();
  mocks.install.mockReturnValue(installed.promise);
  const first = useAppsStore.getState().install(app);
  await expect(useAppsStore.getState().setPinned("journal", true)).rejects.toThrow(
    "current App change",
  );
  installed.resolve(installation);
  await first;
  expect(mocks.setPinned).not.toHaveBeenCalled();
  expect(useAppsStore.getState().installations).toEqual([installation]);
});

it("refreshes permissions after a server conflict without retrying installation or approving new access", async () => {
  const changed = { ...app, permission_version: 5 };
  const conflict = Object.assign(new Error("Permissions changed"), {
    code: "app_permissions_changed",
  });
  mocks.install.mockRejectedValue(conflict);
  mocks.catalog.mockResolvedValue({ apps: [changed] });
  await expect(useAppsStore.getState().install(app)).rejects.toThrow("Permissions changed");
  expect(mocks.install).toHaveBeenCalledExactlyOnceWith(app.id, 4);
  expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith(app.id, "operation-a", false);
  expect(useAppsStore.getState()).toMatchObject({
    catalog: [changed],
    installations: [],
    actionAppId: "",
    loading: false,
    error: expect.stringContaining("Review the refreshed permissions"),
  });
});

it("discards a permission refresh if the account changes while it is loading", async () => {
  const catalog = deferred<{ apps: OfficialApp[] }>();
  mocks.install.mockRejectedValue(
    Object.assign(new Error("Permissions changed"), { code: "app_permissions_changed" }),
  );
  mocks.catalog.mockReturnValue(catalog.promise);
  const pending = useAppsStore.getState().install(app);
  const rejected = expect(pending).rejects.toThrow("Permissions changed");
  await vi.waitFor(() => expect(mocks.catalog).toHaveBeenCalledOnce());
  switchAccount();
  catalog.resolve({ apps: [{ ...app, permission_version: 5 }] });
  await rejected;
  expect(useAppsStore.getState()).toMatchObject({ accountId: "account-b", catalog: [], error: "" });
});
