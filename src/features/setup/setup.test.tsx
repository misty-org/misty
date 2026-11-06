import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupStepBody, useSetupSteps } from "./SetupSteps";
import { setupStorageKey, useSetupStore } from "./useSetupStore";

const mocks = vi.hoisted(() => ({ native: false, extensions: false, setLayout: vi.fn() }));
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
  useSetupStore.setState({ welcomed: false, tabSidePending: false });
  localStorage.clear();
  mocks.native = false;
  mocks.extensions = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("sets up only the tab side outside the desktop app", () => {
  expect(renderHook(() => useSetupSteps()).result.current).toEqual(["tabs"]);
});

it("imports first in the desktop app, with extensions where they run", () => {
  mocks.native = true;
  expect(renderHook(() => useSetupSteps()).result.current).toEqual(["import"]);
  mocks.extensions = true;
  expect(renderHook(() => useSetupSteps()).result.current).toEqual(["import", "extensions"]);
});

it("keeps asking for the tab side after a restart until it has been asked", async () => {
  useSetupStore.getState().askTabSide();
  await useSetupStore.persist.rehydrate();
  expect(useSetupStore.getState().tabSidePending).toBe(true);
  useSetupStore.getState().settleTabSide();
  await useSetupStore.persist.rehydrate();
  expect(useSetupStore.getState().tabSidePending).toBe(false);
});

it("does not ask a device that finished the old setup for its tab side", async () => {
  localStorage.setItem(
    setupStorageKey,
    JSON.stringify({ state: { completedAccounts: { guest: true } }, version: 0 }),
  );
  await useSetupStore.persist.rehydrate();
  expect(useSetupStore.getState().tabSidePending).toBe(false);
});

it("moves the tabs to the side chosen", () => {
  render(<SetupStepBody step="tabs" onNext={vi.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
  expect(mocks.setLayout).toHaveBeenCalledWith({ navigation: "left", tabs: "right" });
});

it("moves on when importing is skipped", () => {
  const onNext = vi.fn();
  render(<SetupStepBody step="import" onNext={onNext} />);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onNext).toHaveBeenCalled();
});

it("treats a device that finished the old setup as welcomed", async () => {
  localStorage.setItem(
    setupStorageKey,
    JSON.stringify({ state: { completedAccounts: { guest: true } }, version: 0 }),
  );
  await useSetupStore.persist.rehydrate();
  expect(useSetupStore.getState().welcomed).toBe(true);
});

it("treats a device that finished the old walkthrough as welcomed", async () => {
  localStorage.setItem(
    "misty-app-tour",
    JSON.stringify({ state: { completedAccounts: { "account-1": true } }, version: 0 }),
  );
  await useSetupStore.persist.rehydrate();
  expect(useSetupStore.getState().welcomed).toBe(true);
});
