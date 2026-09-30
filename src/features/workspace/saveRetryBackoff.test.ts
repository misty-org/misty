import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaveRetryBackoff } from "./saveRetryBackoff";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("retries refused saves after 5 s, doubling up to 5 min, and stops once they land", async () => {
  const retry = vi.fn(async () => undefined);
  const backoff = new SaveRetryBackoff(retry);
  backoff.update(1);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(retry).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(retry).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(retry).toHaveBeenCalledTimes(2);
  // Doubles to the cap, never faster than every 5 minutes after that.
  await vi.advanceTimersByTimeAsync(20_000 + 40_000 + 80_000 + 160_000);
  expect(retry).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(299_999);
  expect(retry).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(1);
  expect(retry).toHaveBeenCalledTimes(7);
  backoff.update(0);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(retry).toHaveBeenCalledTimes(7);
  backoff.dispose();
});

it("retries right away when the window regains focus, and only while saves are refused", async () => {
  const retry = vi.fn(async () => undefined);
  const backoff = new SaveRetryBackoff(retry);
  window.dispatchEvent(new Event("focus"));
  expect(retry).not.toHaveBeenCalled();
  backoff.update(2);
  window.dispatchEvent(new Event("focus"));
  expect(retry).toHaveBeenCalledTimes(1);
  backoff.dispose();
  window.dispatchEvent(new Event("focus"));
  expect(retry).toHaveBeenCalledTimes(1);
});
