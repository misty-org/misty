import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAccountNotSetUp } from "@/api/client/account_limits";
import { settleDeviceSettings } from "@/tests/fake_device_settings";

type Held = { message: string; onDismiss?: () => void };
const notices = vi.hoisted(() => ({ shown: [] as Held[] }));
const db = await vi.hoisted(async () =>
  (await import("@/tests/fake_device_settings")).fakeDeviceSettings(),
);

vi.mock("@/shared/platform/native_invoke", () => ({ invoke: db.invoke }));
vi.mock("../sessions/auth_state", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("@misty/ui", () => ({
  useNotice: (show: boolean, options: Held) => {
    if (show) notices.shown.push(options);
  },
}));

import { AccountSuspendedNotice } from "./AccountSuspendedNotice";

const limitShown = () => notices.shown.some((notice) => /reached a limit/.test(notice.message));

beforeEach(async () => {
  await settleDeviceSettings();
  localStorage.clear();
  notices.shown = [];
  useAccountNotSetUp.setState({ notSetUp: true, hasDevices: false });
});
afterEach(cleanup);

it("says an account reached its limit once, and remembers that in misty.db", async () => {
  const first = render(<AccountSuspendedNotice />);
  await waitFor(() => expect(limitShown()).toBe(true));
  act(() => notices.shown[notices.shown.length - 1]!.onDismiss!());
  first.unmount();
  await settleDeviceSettings();
  expect(db.read("account-limit-notices")).toEqual({ account: expect.any(Number) });

  notices.shown = [];
  render(<AccountSuspendedNotice />);
  await settleDeviceSettings();
  expect(limitShown()).toBe(false);
});

it("says so again if the account got devices and lost them, moving the old dismissal over", async () => {
  localStorage.setItem("misty.account-not-set-up.dismissed.account", "1");
  useAccountNotSetUp.setState({ notSetUp: false, hasDevices: true });
  const first = render(<AccountSuspendedNotice />);
  await settleDeviceSettings();
  first.unmount();
  expect(localStorage.getItem("misty.account-not-set-up.dismissed.account")).toBeNull();
  expect(db.read("account-limit-notices")).toEqual({});

  notices.shown = [];
  useAccountNotSetUp.setState({ notSetUp: true, hasDevices: false });
  render(<AccountSuspendedNotice />);
  await waitFor(() => expect(limitShown()).toBe(true));
});
