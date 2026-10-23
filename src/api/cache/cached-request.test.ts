import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.request }));
import { configureApiSession } from "@/api/client/session";
import { clearApiCache, mutationScope } from "./api-cache";
import { cachedRequest } from "./cached-request";

const signIn = (account: string) =>
  configureApiSession({
    isTransitioning: () => false,
    readGeneration: () => 1,
    readToken: async () => "",
    readAccountId: () => account,
  });

beforeEach(async () => {
  mocks.request.mockReset();
  await clearApiCache("account-1");
  await clearApiCache("account-2");
  signIn("account-1");
});

it("paints the saved copy first, then answers with the fresh response", async () => {
  mocks.request.mockResolvedValueOnce({ items: ["old"] }).mockResolvedValueOnce({ items: ["new"] });
  const painted = vi.fn();
  expect(await cachedRequest("/things", { onCached: painted })).toEqual({ items: ["old"] });
  expect(painted).not.toHaveBeenCalled();
  await vi.waitFor(async () => {
    await cachedRequest("/things", { onCached: painted });
    expect(painted).toHaveBeenCalledWith({ items: ["old"] }, expect.any(Number));
  });
});

it("always asks the server past the web view's own HTTP cache", async () => {
  mocks.request.mockResolvedValue({});
  await cachedRequest("/things", { init: { signal: new AbortController().signal } });
  expect(mocks.request).toHaveBeenCalledWith(
    "/things",
    expect.objectContaining({ cache: "no-store" }),
  );
});

it("keeps one account's copies from another", async () => {
  mocks.request.mockResolvedValue({ mine: true });
  await cachedRequest("/things");
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  signIn("account-2");
  const painted = vi.fn();
  await cachedRequest("/things", { onCached: painted });
  expect(painted).not.toHaveBeenCalled();
});

it("scopes a change to the part of the path it reaches", () => {
  expect(mutationScope("/spaces/abc/tasks/9?x=1")).toBe("/spaces/abc");
  expect(mutationScope("/spaces")).toBe("/spaces");
  expect(mutationScope("/integrations/apps/connect")).toBe("/integrations/apps");
});
