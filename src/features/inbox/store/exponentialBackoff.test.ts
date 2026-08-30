import { describe, expect, it, vi } from "vitest";
import { withExponentialBackoff } from "./exponentialBackoff";

describe("Inbox exponential backoff", () => {
  it("doubles retry delays and eventually returns the prefetched value", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValue("message");
    const sleep = vi.fn<(delayMs: number) => Promise<void>>(async () => undefined);

    await expect(
      withExponentialBackoff(operation, {
        attempts: 5,
        baseDelayMs: 750,
        maxDelayMs: 12_000,
        sleep,
        random: () => 0.5,
      }),
    ).resolves.toBe("message");
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([750, 1500]);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("stops after the configured attempt limit", async () => {
    const operation = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const sleep = vi.fn<(delayMs: number) => Promise<void>>(async () => undefined);

    await expect(
      withExponentialBackoff(operation, {
        attempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10_000,
        sleep,
        random: () => 0.5,
      }),
    ).rejects.toThrow("provider unavailable");
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000]);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
