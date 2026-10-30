import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openSystemExternalLink: vi.fn(),
  mistyPublicPage: vi.fn((path: string): string | null => `https://misty.example${path}`),
}));

vi.mock("@/shared/platform/mistyPublicUrl", () => ({
  mistyPublicPage: mocks.mistyPublicPage,
}));
vi.mock("@/shared/platform/openExternalLink", () => ({
  openSystemExternalLink: mocks.openSystemExternalLink,
}));

import { openAccountSettingsInBrowser } from "./openAccountSettings";

describe("openAccountSettingsInBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the settings page in the system browser", async () => {
    await openAccountSettingsInBrowser();

    expect(mocks.mistyPublicPage).toHaveBeenCalledWith("/settings");
    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith("https://misty.example/settings");
  });

  it("passes a requested account surface through", async () => {
    await openAccountSettingsInBrowser("/settings/privacy");

    expect(mocks.mistyPublicPage).toHaveBeenCalledWith("/settings/privacy");
    expect(mocks.openSystemExternalLink).toHaveBeenCalledWith(
      "https://misty.example/settings/privacy",
    );
  });

  it("refuses when this build names no account website", async () => {
    mocks.mistyPublicPage.mockReturnValueOnce(null);
    await expect(openAccountSettingsInBrowser()).rejects.toThrow("no account website");
    expect(mocks.openSystemExternalLink).not.toHaveBeenCalled();
  });

  it("propagates failures so the caller can surface them", async () => {
    const failure = new Error("Failed to open browser");
    mocks.openSystemExternalLink.mockRejectedValue(failure);

    await expect(openAccountSettingsInBrowser()).rejects.toThrow("Failed to open browser");
  });
});
