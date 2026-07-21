import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generation: 0,
  fetch: vi.fn(),
  appSnapshot: vi.fn().mockResolvedValue({ environment: { serverUrl: "https://api.test" } }),
}));

vi.mock("@/stores/backend", () => ({
  appSnapshot: mocks.appSnapshot,
  normalizeApiBaseUrl: (value: string | null | undefined) => value || null,
  withDefaultApiPath: (value: string | null | undefined) => `${value ?? ""}/api`,
}));
vi.mock("@/stores/account/useAuthTokenStore", () => ({
  clearAccountAuthToken: vi.fn().mockResolvedValue(null),
  readAccountAuthToken: vi.fn().mockResolvedValue("account-a-token"),
  readAccountSessionGeneration: () => mocks.generation,
  saveAccountAuthToken: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/platform/buildTarget", () => ({
  isAndroidBuild: false,
  isNativeMobileBuild: false,
}));
vi.mock("@/analytics/client", () => ({
  analytics: { isAnalyticsEnabled: () => false },
}));

import { accountFetchMe } from "@/stores/account/useAccountStore";

describe("account API generation isolation", () => {
  beforeEach(() => {
    mocks.generation = 0;
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("rejects a response body that finishes after the active account changes", async () => {
    let resolveBody: ((value: string) => void) | undefined;
    const body = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://api.test/api/me",
      headers: new Headers({ "Content-Type": "application/json" }),
      text: () => body,
    } as Response);

    const request = accountFetchMe();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    mocks.generation += 1;
    resolveBody?.(
      JSON.stringify({
        id: "account-a",
        name: "Account A",
        email: "a@example.test",
      }),
    );

    await expect(request).rejects.toThrow(
      "The active Misty account changed before this request finished.",
    );
  });
});
