import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "./types";

const mocks = vi.hoisted(() => ({
  tauri: true,
  focused: false,
  granted: true,
  requestedPermission: "granted" as NotificationPermission,
  preferences: {
    badgeCountEnabled: true,
    desktopNotificationsEnabled: true,
    digestNotificationsEnabled: false,
    inAppNotificationsEnabled: true,
    quietHoursEnabled: false,
    soundNotificationsEnabled: false,
  },
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted" as NotificationPermission),
  sendNotification: vi.fn(),
  isFocused: vi.fn(async () => false),
  setBadgeCount: vi.fn(async () => undefined),
}));

vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => mocks.tauri,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
  sendNotification: mocks.sendNotification,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: mocks.isFocused,
    setBadgeCount: mocks.setBadgeCount,
  }),
}));

vi.mock("@/features/settings", () => ({
  selectNotificationPreferences: () => mocks.preferences,
  useSettingsStore: { getState: () => ({ settings: { document: {} } }) },
}));

import {
  nativeNotificationPermission,
  publishNativeActivity,
  requestNativeNotificationPermission,
  syncNativeBadge,
} from "./nativeNotifications";

describe("nativeNotifications", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.tauri = true;
    mocks.focused = false;
    mocks.granted = true;
    mocks.requestedPermission = "granted";
    mocks.preferences.badgeCountEnabled = true;
    mocks.preferences.desktopNotificationsEnabled = true;
    mocks.preferences.digestNotificationsEnabled = false;
    mocks.preferences.quietHoursEnabled = false;
    mocks.preferences.soundNotificationsEnabled = false;
    mocks.isPermissionGranted.mockImplementation(async () => mocks.granted);
    mocks.requestPermission.mockImplementation(async () => mocks.requestedPermission);
    mocks.isFocused.mockImplementation(async () => mocks.focused);
    mocks.sendNotification.mockClear();
    mocks.setBadgeCount.mockClear();
    mocks.requestPermission.mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  it("suppresses OS banners while Misty is focused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    expect(await publishNativeActivity(itemFixture())).toBe(false);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("sends a native background notification and respects sound preference", async () => {
    mocks.preferences.soundNotificationsEnabled = true;
    expect(await publishNativeActivity(itemFixture())).toBe(true);
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Transfer needs attention",
        body: "A file could not be copied.",
        sound: "Ping",
      }),
    );
  });

  it.each(["disabled", "quiet", "digest"])("suppresses %s background delivery", async (mode) => {
    if (mode === "disabled") mocks.preferences.desktopNotificationsEnabled = false;
    if (mode === "quiet") mocks.preferences.quietHoursEnabled = true;
    if (mode === "digest") mocks.preferences.digestNotificationsEnabled = true;
    expect(await publishNativeActivity(itemFixture())).toBe(false);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("never requests permission during publication", async () => {
    mocks.granted = false;
    expect(await nativeNotificationPermission()).toBe("prompt");
    expect(await publishNativeActivity(itemFixture())).toBe(false);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission only through the explicit permission operation", async () => {
    mocks.requestedPermission = "denied";
    mocks.granted = false;
    expect(await requestNativeNotificationPermission()).toBe("denied");
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(await nativeNotificationPermission()).toBe("denied");
  });

  it("keeps a dismissed permission prompt requestable", async () => {
    mocks.requestedPermission = "default";
    mocks.granted = false;
    expect(await requestNativeNotificationPermission()).toBe("prompt");
    expect(await nativeNotificationPermission()).toBe("prompt");
  });

  it("sends the full Dock count and clears it at zero or when badges are disabled", async () => {
    await syncNativeBadge(147);
    await syncNativeBadge(0);
    mocks.preferences.badgeCountEnabled = false;
    await syncNativeBadge(8);

    expect(mocks.setBadgeCount).toHaveBeenNthCalledWith(1, 147);
    expect(mocks.setBadgeCount).toHaveBeenNthCalledWith(2, undefined);
    expect(mocks.setBadgeCount).toHaveBeenNthCalledWith(3, undefined);
  });
});

function itemFixture(): ActivityItem {
  return {
    id: "device:account-1:transfer-1",
    accountId: "account-1",
    source: "device",
    sourceId: "transfer-1",
    kind: "failure",
    title: "Transfer needs attention",
    body: "A file could not be copied.",
    createdAt: "2026-08-08T12:00:00Z",
    attention: true,
    target: { kind: "workspace-tool", tool: "transfers" },
  };
}
