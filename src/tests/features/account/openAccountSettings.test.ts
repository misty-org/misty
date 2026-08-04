import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountCreateHandoffUrl: vi.fn(),
  openSystemExternalLink: vi.fn(),
}));

vi.mock("@/stores/account/useAccountStore", () => ({
  accountCreateHandoffUrl: mocks.accountCreateHandoffUrl,
}));
vi.mock("@/platform/openExternalLink", () => ({
  openSystemExternalLink: mocks.openSystemExternalLink,
}));

import { openAccountSettingsInBrowser } from "@/features/account/openAccountSettings";

describe("openAccountSettingsInBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountCreateHandoffUrl.mockResolvedValue({
      url: "https://misty.test/auth/handoff/start?token=abc",
    });
  });

  it("opens the minted hand-off URL in the system browser", async () => {
    await openAccountSettingsInBrowser();

    expect(mocks.accountCreateHandoffUrl).toHaveBeenCalledWith("/settings");
    // The system browser, not an in-app webview: the whole point is to leave
    // the app for a surface that can show account data properly.
    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith(
      "https://misty.test/auth/handoff/start?token=abc",
    );
  });

  it("passes a requested account surface through", async () => {
    await openAccountSettingsInBrowser("/settings/billing");

    expect(mocks.accountCreateHandoffUrl).toHaveBeenCalledWith("/settings/billing");
  });

  it("propagates failures so the caller can surface them", async () => {
    const failure = new Error("offline");
    mocks.accountCreateHandoffUrl.mockRejectedValue(failure);

    await expect(openAccountSettingsInBrowser()).rejects.toThrow("offline");
    // Never open a browser tab that would land on a sign-in wall.
    expect(mocks.openSystemExternalLink).not.toHaveBeenCalled();
  });
});
