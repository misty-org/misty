import { afterEach, expect, it, vi } from "vitest";
import { createAppSessionRequests } from "./sessionRequests";
import { ApiRequestError } from "@/api/client/errors";
import type { OfficialAppSession } from "./api";
afterEach(() => vi.useRealTimers());
const session = (authority = 1) =>
  ({
    app_id: "files",
    space_id: "space",
    authority_generation: authority,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
  }) as OfficialAppSession;
it("shares concurrent and sequential native operations until renewal is needed", async () => {
  vi.useFakeTimers();
  const get = createAppSessionRequests(() => 1);
  const fetch = vi.fn(async () => session());
  await Promise.all(Array.from({ length: 20 }, () => get("files", "space", 1, fetch)));
  await get("files", "space", 1, fetch);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(76_000);
  await get("files", "space", 1, fetch);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("honors Retry-After across remounts and apps without scheduling retries", async () => {
  vi.useFakeTimers();
  const get = createAppSessionRequests(() => 1);
  const error = new ApiRequestError("Slow down", 429, undefined, "", 90_000);
  const fetch = vi.fn().mockRejectedValue(error);
  for (let n = 0; n < 20; n++)
    await expect(get(n % 2 ? "files" : "library", "space", 1, fetch)).rejects.toBe(error);
  vi.advanceTimersByTime(89_000);
  await expect(get("files", "space", 2, fetch)).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1001);
  await expect(get("files", "space", 2, fetch)).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("isolates authority changes and account changes, including late responses", async () => {
  let epoch = 1;
  const get = createAppSessionRequests(() => epoch);
  const fetch = vi.fn(async () => session());
  await get("files", "space", 1, fetch);
  await get("files", "space", 2, fetch);
  expect(fetch).toHaveBeenCalledTimes(2);
  let resolve!: (value: OfficialAppSession) => void;
  const pending = get(
    "files",
    "other",
    1,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await Promise.resolve();
  epoch++;
  resolve(session());
  await expect(pending).rejects.toThrow("access changed");
  await get("files", "space", 1, fetch);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("drops cached tokens on connection changes", async () => {
  const get = createAppSessionRequests(() => 1);
  const fetch = vi.fn(async () => session());
  await get("files", "space", 1, fetch);
  get.invalidate("files", "space");
  await get("files", "space", 1, fetch);
  expect(fetch).toHaveBeenCalledTimes(2);
});
