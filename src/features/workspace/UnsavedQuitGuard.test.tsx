import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
  handler: undefined as undefined | ((event: { payload: unknown }) => Promise<void>),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: typeof mocks.handler) => {
    mocks.handler = handler;
    return () => undefined;
  }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/browser-workspace/recovery", () => ({ flushWorkspaceRecovery: mocks.flush }));
import { UnsavedQuitGuard } from "./UnsavedQuitGuard";

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.flush.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

async function hold(payload: { unsaved: number; closing: boolean }) {
  render(<UnsavedQuitGuard />);
  await act(async () => undefined);
  await act(async () => mocks.handler!({ payload }));
}

it("saves first and finishes quitting without asking when the save lands", async () => {
  await hold({ unsaved: 2, closing: false });
  expect(mocks.flush).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith("app_quit_confirmed", { closing: false });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("asks before quitting when changes still cannot be saved", async () => {
  mocks.flush.mockRejectedValue(new Error("disk"));
  await hold({ unsaved: 2, closing: false });
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.getByText("Some changes are not saved on this device")).toBeTruthy();
  expect(screen.getByText(/2 changes exist only in this window/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Quit anyway" })));
  expect(mocks.invoke).toHaveBeenCalledWith("app_quit_confirmed", { closing: false });
});

it("keeps Misty open when asked, and closes only the window when that was the request", async () => {
  mocks.flush.mockRejectedValue(new Error("disk"));
  await hold({ unsaved: 1, closing: true });
  expect(screen.getByRole("button", { name: "Close anyway" })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep Misty open" })));
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.queryByText("Some changes are not saved on this device")).toBeNull();
});
