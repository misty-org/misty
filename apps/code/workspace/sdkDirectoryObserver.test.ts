import { afterEach, expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import { observeSdkDirectory } from "./sdkDirectoryObserver";
afterEach(() => vi.useRealTimers());

it("coalesces native revisions, reopens a moved root, and stops polling on close", async () => {
  vi.useFakeTimers();
  let revision = 0,
    moved = false,
    count = 0;
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "files.watchDirectory") {
      moved = false;
      return { watcher: `watch-${++count}` };
    }
    if (method === "files.watchStatus")
      return { revision, active: !moved, reason: moved ? "root_changed" : null };
    return null;
  });
  const files = createMistyAppSDK({ request }).files;
  const onChange = vi.fn(),
    onError = vi.fn(),
    lifetime = new AbortController();
  const stop = await observeSdkDirectory(files, "folder", {
    signal: lifetime.signal,
    onChange,
    onError,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(onChange).not.toHaveBeenCalled();
  revision = 50;
  await vi.advanceTimersByTimeAsync(500);
  expect(onChange).toHaveBeenCalledTimes(1);
  moved = true;
  await vi.advanceTimersByTimeAsync(500);
  expect(count).toBe(2);
  expect(request).toHaveBeenCalledWith({
    method: "files.watchClose",
    params: { watcher: "watch-1" },
  });
  await stop();
  const calls = request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(request).toHaveBeenCalledTimes(calls);
  expect(request).toHaveBeenLastCalledWith({
    method: "files.watchClose",
    params: { watcher: "watch-2" },
  });
  expect(onError).not.toHaveBeenCalled();
});
it("releases a watch lease acquired after cancellation", async () => {
  vi.useFakeTimers();
  let finish!: (result: unknown) => void;
  const request = vi.fn(async ({ method }: { method: string }) =>
    method === "files.watchDirectory"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : null,
  );
  const files = createMistyAppSDK({ request }).files;
  const lifetime = new AbortController(),
    onChange = vi.fn(),
    onError = vi.fn();
  const pending = observeSdkDirectory(files, "folder", {
    signal: lifetime.signal,
    onChange,
    onError,
  });
  const rejected = expect(pending).rejects.toThrow("closed");
  lifetime.abort();
  finish({ watcher: "late" });
  await rejected;
  expect(request).toHaveBeenLastCalledWith({
    method: "files.watchClose",
    params: { watcher: "late" },
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(onChange).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("ignores a pending status reply after closure and reports native failure once", async () => {
  vi.useFakeTimers();
  let finish!: (result: unknown) => void;
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "files.watchDirectory") return { watcher: "watch" };
    if (method === "files.watchStatus")
      return new Promise((resolve) => {
        finish = resolve;
      });
    return null;
  });
  const files = createMistyAppSDK({ request }).files;
  const onChange = vi.fn(),
    onError = vi.fn(),
    lifetime = new AbortController();
  const stop = await observeSdkDirectory(files, "folder", {
    signal: lifetime.signal,
    onChange,
    onError,
  });
  await vi.advanceTimersByTimeAsync(500);
  await stop();
  finish({ revision: 1, active: true, reason: null });
  await vi.advanceTimersByTimeAsync(1000);
  expect(onChange).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  const second = await observeSdkDirectory(files, "folder", {
    signal: lifetime.signal,
    onChange,
    onError,
  });
  await vi.advanceTimersByTimeAsync(500);
  finish({ revision: 1, active: false, reason: "watch_failed" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(onChange).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledOnce();
  const count = request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(request).toHaveBeenCalledTimes(count);
  await second();
});
