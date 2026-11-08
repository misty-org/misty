import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  temporary: vi.fn(),
  credentials: vi.fn(),
  generation: 1,
}));
vi.mock("@/api/client/session", () => ({
  readApiAuthToken: mocks.credentials,
  readApiSessionGeneration: () => mocks.generation,
  isApiSessionTransitioning: () => false,
}));
vi.mock("./workspaceRecoveryPlatform", () => ({ nativeWorkspaceRecoveryEnabled: () => true }));
vi.mock("./nativeWorkspaceRecovery", () => ({
  restoreNativeWorkspace: mocks.restore,
  continueWithTemporaryWorkspace: mocks.temporary,
  useWorkspaceRecoveryState: create(() => ({
    accountId: "a",
    ready: false,
    usable: true,
    issue: "Disk unavailable" as string | null,
  })),
}));
import { useWorkspaceRecoveryState } from "./nativeWorkspaceRecovery";
import { useWorkspaceRecoveryRetry } from "./useWorkspaceRecoveryRetry";
function View() {
  useWorkspaceRecoveryRetry("a");
  return (
    <>
      <button>Browse</button>
    </>
  );
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.generation = 1;
  mocks.credentials.mockResolvedValue("token");
  mocks.restore.mockResolvedValue(undefined);
  useWorkspaceRecoveryState.setState({
    accountId: "a",
    ready: false,
    usable: true,
    issue: "Disk unavailable",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
it("keeps browsing available, backs off retries, and retries immediately on focus or online", async () => {
  await act(async () => root.render(<View />));
  expect(container.querySelector("button")?.disabled).toBe(false);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(3999));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(mocks.restore).toHaveBeenCalledTimes(2);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.restore).toHaveBeenCalledTimes(3);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(mocks.restore).toHaveBeenCalledTimes(4);
});
it("stops retrying once local saving recovers", async () => {
  mocks.restore.mockImplementation(async () => {
    useWorkspaceRecoveryState.setState({ ready: true, issue: null });
  });
  await act(async () => root.render(<View />));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("Browse");
});
it("does not retry credentials from a previous account generation", async () => {
  let resolve!: () => void;
  mocks.credentials.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await act(async () => root.render(<View />));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  mocks.generation++;
  await act(async () => resolve());
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.temporary).not.toHaveBeenCalled();
});
it("makes a stalled initial read usable after three seconds and cancels timers on unmount", async () => {
  useWorkspaceRecoveryState.setState({ usable: false, issue: null });
  await act(async () => root.render(<View />));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(mocks.temporary).toHaveBeenCalledWith("a", expect.any(Error));
  await act(async () => root.render(null));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.restore).not.toHaveBeenCalled();
});
