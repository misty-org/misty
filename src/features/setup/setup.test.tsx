import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FirstRunSetup } from "./FirstRunSetup";
import { isSetupCompletedForAccount, setupStorageKey, useSetupStore } from "./useSetupStore";

const mocks = vi.hoisted(() => ({
  native: false,
  extensions: false,
  suspend: vi.fn(),
  setLayout: vi.fn(),
}));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1" }, transitioning: false }),
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: mocks.suspend,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
vi.mock("@/features/workspace", () => ({
  useWindowDockingLayout: () => ({ navigation: "right", tabs: "left" }),
  useWorkspaceStore: (select: (state: unknown) => unknown) =>
    select({ setWindowDockingLayout: mocks.setLayout }),
}));
vi.mock("@/features/extensions/store", () => ({
  useExtensionsStore: (select: (state: { supported: boolean }) => unknown) =>
    select({ supported: mocks.extensions }),
}));
vi.mock("@/features/extensions/ExtensionsSetupStep", () => ({
  ExtensionsSetupStep: () => <p>Extension choices</p>,
}));
vi.mock("@/features/browser-import", () => ({
  BrowserImportFlow: (props: { onClose(): void; closeLabel?: string }) => (
    <button type="button" onClick={props.onClose}>
      {props.closeLabel}
    </button>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  useSetupStore.setState({ isOpen: false, step: "import", completedAccounts: {} });
  mocks.native = false;
  mocks.extensions = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("asks where the tabs go and finishes", () => {
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  expect(screen.getByText("Where do you want your tabs?")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
  expect(mocks.setLayout).toHaveBeenCalledWith({ navigation: "left", tabs: "right" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText("Where do you want your tabs?")).toBeNull();
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-2")).toBe(false);
});

it("starts with importing from another browser in the desktop app", () => {
  mocks.native = true;
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  expect(screen.getByText("Import from your browser")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.getByText("Where do you want your tabs?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
});

it("offers optional extensions between importing and the tab side where extensions run", () => {
  mocks.native = true;
  mocks.extensions = true;
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.getByText("Add an ad blocker and a password manager")).toBeTruthy();
  expect(screen.getByText("Step 2 of 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Where do you want your tabs?")).toBeTruthy();
});

it("skips the extensions step where extensions do not run", () => {
  mocks.native = true;
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.queryByText("Add an ad blocker and a password manager")).toBeNull();
  expect(screen.getByText("Step 2 of 2")).toBeTruthy();
});

it("can be cancelled, and hides page views while open", () => {
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  expect(mocks.suspend).toHaveBeenLastCalledWith(true, "first-run-setup");
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "first-run-setup");
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
});

it("treats accounts that finished the old walkthrough as already set up", async () => {
  localStorage.setItem(
    "misty-app-tour",
    JSON.stringify({ state: { completedAccounts: { "account-1": true } }, version: 0 }),
  );
  localStorage.removeItem(setupStorageKey);
  await useSetupStore.persist.rehydrate();
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
});

it("counts setup done without an account for whoever signs in", () => {
  useSetupStore.getState().finishSetup(null);
  expect(isSetupCompletedForAccount(useSetupStore.getState(), null)).toBe(true);
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-2")).toBe(true);
});
