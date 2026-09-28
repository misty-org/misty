import { afterEach, expect, it, vi } from "vitest";
import { companionStage } from "./companionStage";
afterEach(() => vi.useRealTimers());
it("bounds a stalled individual stage and consumes a late rejection", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const work = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const result = expect(
    companionStage(work, new AbortController().signal, "Capture", 100),
  ).rejects.toThrow("Capture timed out");
  await vi.advanceTimersByTimeAsync(100);
  await result;
  fail(new Error("late failure"));
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels promptly while the underlying native work is still pending", async () => {
  const controller = new AbortController();
  const result = companionStage(new Promise(() => {}), controller.signal, "Capture", 10000);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
