import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { settleDeviceSettings } from "@/tests/fakeDeviceSettings";
import { SetupStepBody, useSetupSteps } from "./SetupSteps";
import { setupStorageKey, useSetupStore } from "../../account/setup/useSetupStore";

const mocks = vi.hoisted(() => ({ native: false, setLayout: vi.fn() }));
const db = await vi.hoisted(async () =>
  (await import("@/tests/fakeDeviceSettings")).fakeDeviceSettings(),
);
vi.mock("@/native/invoke", () => ({ invoke: db.invoke }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
vi.mock("@/features/app-windows", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWindowDockingLayout: () => ({ navigation: "right", tabs: "left" }),
  useWorkspaceStore: (select: (state: unknown) => unknown) =>
    select({ setWindowDockingLayout: mocks.setLayout }),
}));

/** The setup store as a new window (or a restart) makes it, once `misty.db` has answered. */
async function restart() {
  vi.resetModules();
  const { useSetupStore: fresh } = await import("../../account/setup/useSetupStore");
  await settleDeviceSettings();
  return fresh;
}

beforeEach(async () => {
  await settleDeviceSettings();
  useSetupStore.setState({ welcomed: false, tabSidePending: false });
  localStorage.clear();
  db.reset();
  mocks.native = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("sets up only the tab side outside the desktop app", () => {
  expect(renderHook(() => useSetupSteps()).result.current).toEqual(["tabs"]);
});

it("sets up the tab side in the desktop app too", () => {
  mocks.native = true;
  expect(renderHook(() => useSetupSteps()).result.current).toEqual(["tabs"]);
});

it("keeps asking for the tab side after a restart until it has been asked", async () => {
  useSetupStore.getState().askTabSide();
  await settleDeviceSettings();
  expect(db.read("first-run-setup")).toEqual({ welcomed: false, tabSidePending: true });
  localStorage.clear();
  const afterAsking = await restart();
  expect(afterAsking.getState().tabSidePending).toBe(true);
  afterAsking.getState().settleTabSide();
  await settleDeviceSettings();
  localStorage.clear();
  expect((await restart()).getState().tabSidePending).toBe(false);
});

it("does not ask a device that finished the old setup for its tab side", async () => {
  localStorage.setItem(
    setupStorageKey,
    JSON.stringify({ state: { completedAccounts: { guest: true } }, version: 0 }),
  );
  expect((await restart()).getState().tabSidePending).toBe(false);
});

it("moves the tabs to the side chosen", () => {
  render(<SetupStepBody step="tabs" onNext={vi.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: /Right/ }));
  expect(mocks.setLayout).toHaveBeenCalledWith({ navigation: "left", tabs: "right" });
});

it("treats a device that finished the old setup as welcomed and moves it into misty.db", async () => {
  localStorage.setItem(
    setupStorageKey,
    JSON.stringify({ state: { completedAccounts: { guest: true } }, version: 0 }),
  );
  expect((await restart()).getState().welcomed).toBe(true);
  expect(db.read("first-run-setup")).toEqual({ welcomed: true, tabSidePending: false });
  expect(localStorage.getItem(setupStorageKey)).toBeNull();
});

it("treats a device that finished the old walkthrough as welcomed", async () => {
  localStorage.setItem(
    "misty-app-tour",
    JSON.stringify({ state: { completedAccounts: { "account-1": true } }, version: 0 }),
  );
  expect((await restart()).getState().welcomed).toBe(true);
});
