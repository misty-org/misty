import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountCreateHandoffUrl: vi.fn(),
  resolveAccountApiBase: vi.fn(),
  openSystemExternalLink: vi.fn(),
}));

vi.mock("@/stores/account/useAccountStore", () => ({
  accountCreateHandoffUrl: mocks.accountCreateHandoffUrl,
  resolveAccountApiBase: mocks.resolveAccountApiBase,
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
    mocks.resolveAccountApiBase.mockResolvedValue("https://misty.test/api");
  });

  it("opens the minted hand-off URL in the system browser", async () => {
    await openAccountSettingsInBrowser();

    expect(mocks.accountCreateHandoffUrl).toHaveBeenCalledWith("/settings");
    // The system browser, not an in-app webview: the whole point is to leave
    // the app for a surface that can show account data properly.
    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith(
      "https://misty.test/api/auth/handoff/start?token=abc",
    );
  });

  it("passes a requested account surface through", async () => {
    await openAccountSettingsInBrowser("/settings/billing");

    expect(mocks.accountCreateHandoffUrl).toHaveBeenCalledWith("/settings/billing");
  });

  // A server with no AUTH_HANDOFF_START_URL mints http://localhost:8080, which
  // answers nothing when the app talks to a tunnel — the click opened a dead
  // tab instead of the website.
  it("re-points a stale hand-off origin at the API the app actually uses", async () => {
    mocks.accountCreateHandoffUrl.mockResolvedValue({
      url: "http://localhost:8080/auth/handoff/start?token=abc",
    });
    mocks.resolveAccountApiBase.mockResolvedValue("https://tunnel.example.com/api");

    await openAccountSettingsInBrowser();

    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith(
      "https://tunnel.example.com/api/auth/handoff/start?token=abc",
    );
  });

  it("leaves a hand-off already on the configured origin untouched", async () => {
    mocks.accountCreateHandoffUrl.mockResolvedValue({
      url: "https://misty.test/api/auth/handoff/start?token=abc",
    });
    mocks.resolveAccountApiBase.mockResolvedValue("https://misty.test/api");

    await openAccountSettingsInBrowser();

    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith(
      "https://misty.test/api/auth/handoff/start?token=abc",
    );
  });

  it("keeps the minted URL when the API base cannot be resolved", async () => {
    mocks.resolveAccountApiBase.mockRejectedValue(new Error("no server configured"));

    await openAccountSettingsInBrowser();

    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith(
      "https://misty.test/auth/handoff/start?token=abc",
    );
  });

  it("propagates failures so the caller can surface them", async () => {
    const failure = new Error("offline");
    mocks.accountCreateHandoffUrl.mockRejectedValue(failure);

    await expect(openAccountSettingsInBrowser()).rejects.toThrow("offline");
    // Never open a browser tab that would land on a sign-in wall.
    expect(mocks.openSystemExternalLink).not.toHaveBeenCalled();
  });
});
