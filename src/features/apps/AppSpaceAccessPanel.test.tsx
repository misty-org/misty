import { appConsentKey, useAppConsent } from "./useAppConsent";
import { useAppDownloads, appDownloadKey } from "./useAppDownloads";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OfficialApp } from "@/api/apps";
import { useAppsStore } from "./useAppsStore";
import { OfficialAppDetails } from "./OfficialAppDetails";
const mocks = vi.hoisted(() => ({
  remove: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(true),
  change: vi.fn().mockResolvedValue(undefined),
  spaces: [
    { id: "family", name: "Family", role: "owner" },
    { id: "work", name: "Work", role: "owner" },
    { id: "club", name: "Club", role: "member" },
  ],
  installations: vi.fn().mockResolvedValue({ apps: [] }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("./desktop-package-runtime", () => ({
  officialDesktopPackageReady: mocks.ready,
  installOfficialDesktopPackage: mocks.download,
  uninstallOfficialDesktopPackage: mocks.remove,
}));
vi.mock("@/api/apps", () => ({
  appsApi: { installations: mocks.installations, catalog: async () => ({ apps: [] }) },
}));
vi.mock("@/features/spaces/core", () => ({
  useSpacesStore: Object.assign(
    (select: (state: unknown) => unknown) => select({ spaces: mocks.spaces }),
    { getState: () => ({ spaces: mocks.spaces }) },
  ),
}));
beforeEach(() => {
  useAppConsent.setState({ agreed: {} });
  mocks.ready.mockResolvedValue(true);
  mocks.installations.mockResolvedValue({ apps: [] });
  useAppDownloads.setState({ removed: {}, ready: { [appDownloadKey(app)]: true } });
  useAppsStore.getState().reset();
  useAppsStore.setState({ accountId: "one", spaceId: "family", setSpaceEnabled: mocks.change });
});
const app = {
  id: "journal",
  name: "Journal",
  description: "Notes.",
  publisher: "Misty",
  version: "1",
  permission_version: 1,
  scopes: ["files.read"],
  desktop: { runtime: "downloaded" },
  mobile: { runtime: "hosted" },
} as OfficialApp;
function setup() {
  render(
    <OfficialAppDetails
      app={app}
      actionAppId=""
      mobile={false}
      error=""
      onClose={() => {}}
      onRestoreFocus={() => {}}
      onInstall={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("adds only selected Spaces after explicit permission review", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect((screen.getByRole("checkbox", { name: "Family" }) as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  expect((screen.getByRole("checkbox", { name: "Club" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Family" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("heading", { name: "App permissions" })).toBeTruthy();
  expect(mocks.change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Agree" }));
  await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(2));
  expect(mocks.change).toHaveBeenNthCalledWith(1, app, "family", true);
  expect(mocks.change).toHaveBeenNthCalledWith(2, app, "work", true);
});
it("removes access only from the chosen Space after confirmation", async () => {
  mocks.installations.mockResolvedValue({
    apps: [
      {
        app_id: "journal",
        state: "installed",
        installed_version: "1",
        permission_version: 1,
        granted_scopes: ["files.read"],
      },
    ],
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect((screen.getByRole("checkbox", { name: "Work" }) as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.change).toHaveBeenCalledExactlyOnceWith(app, "work", false));
});

it("keeps available Spaces selectable when another Space fails to load", async () => {
  mocks.installations.mockImplementation(async (id: string) => {
    if (id === "club") throw new Error("Forbidden");
    return { apps: [] };
  });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect((screen.getByRole("checkbox", { name: "Work" }) as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  expect(screen.getByRole("alert").textContent).toContain("Some Spaces could not be loaded");
  fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("heading", { name: "App permissions" })).toBeTruthy();
});

it("starts with existing access checked and saves mixed changes only after review", async () => {
  mocks.installations.mockImplementation(async (id: string) => ({
    apps:
      id === "family"
        ? [
            {
              app_id: "journal",
              state: "installed",
              installed_version: "1",
              permission_version: 1,
              granted_scopes: ["files.read"],
            },
          ]
        : [],
  }));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const family = await screen.findByRole("checkbox", { name: "Family" });
  expect((family as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(family);
  fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText(/Access will also be removed from Family/)).toBeTruthy();
  expect(mocks.change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Agree" }));
  await waitFor(() => expect(mocks.change).toHaveBeenCalledTimes(2));
  expect(mocks.change).toHaveBeenCalledWith(app, "family", false);
  expect(mocks.change).toHaveBeenCalledWith(app, "work", true);
});

it("reviews permissions before downloading and then exposes Add without granting any Space access", async () => {
  useAppDownloads.setState({ removed: {}, ready: {} });
  mocks.ready.mockResolvedValue(false);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Get" }));
  expect(screen.getByRole("heading", { name: "App permissions" })).toBeTruthy();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Agree" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeTruthy());
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(app);
  expect(mocks.change).not.toHaveBeenCalled();
});

it("reuses personal agreement when adding another Space", async () => {
  useAppConsent.getState().agree("one", app);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect((screen.getByRole("checkbox", { name: "Work" }) as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.change).toHaveBeenCalledExactlyOnceWith(app, "work", true));
  expect(screen.queryByRole("heading", { name: "App permissions" })).toBeNull();
});

it("Cancel returns without consenting, downloading, or changing Space access", () => {
  useAppDownloads.setState({ removed: {}, ready: {} });
  mocks.ready.mockResolvedValue(false);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Get" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Get" })).toBeTruthy();
  expect(useAppConsent.getState().agreed[appConsentKey("one", app)]).toBeUndefined();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.change).not.toHaveBeenCalled();
});

it("keeps consent personal and requires review when permissions change", () => {
  useAppConsent.getState().agree("one", app);
  const state = useAppConsent.getState();
  expect(state.agreed[appConsentKey("two", app)]).toBeUndefined();
  expect(state.agreed[appConsentKey("one", { ...app, version: "2" })]).toBe(true);
  expect(state.agreed[appConsentKey("one", { ...app, permission_version: 2 })]).toBeUndefined();
  expect(
    state.agreed[appConsentKey("one", { ...app, scopes: [...app.scopes, "files.write"] })],
  ).toBeUndefined();
});

it("confirms device removal, deletes only this app's local data, and preserves Space access", async () => {
  const own = "misty:app:v3:https%3A%2F%2Fapi.test:one:journal:family:draft";
  const other = "misty:app:v3:https%3A%2F%2Fapi.test:one:browser:family:draft";
  localStorage.setItem(own, "notes");
  localStorage.setItem(other, "keep");
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.getByText(/Spaces using Journal will keep access/)).toBeTruthy();
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(localStorage.getItem(own)).toBe("notes");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Get" })).toBeTruthy());
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(app.id);
  expect(localStorage.getItem(own)).toBeNull();
  expect(localStorage.getItem(other)).toBe("keep");
  expect(mocks.change).not.toHaveBeenCalled();
  expect(useAppDownloads.getState().removed[app.id]).toBe(true);
  await expect(useAppDownloads.getState().get(app, true)).rejects.toThrow("Get this app again");
  await useAppDownloads.getState().get(app);
  expect(useAppDownloads.getState().removed[app.id]).toBe(false);
});
