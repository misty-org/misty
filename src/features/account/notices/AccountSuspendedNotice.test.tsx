import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAccountNotSetUp } from "@/api/client/accountLimits";

type Held = { message: string; onDismiss?: () => void };
const notices = vi.hoisted(() => ({ shown: [] as Held[] }));

vi.mock("../sessions/authState", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("@/shared/ui", () => ({
  // Records what is held up on each render, as the notice stack would show it.
  useNotice: (show: boolean, options: Held) => {
    if (show) notices.shown.push(options);
  },
}));

import { AccountSuspendedNotice } from "./AccountSuspendedNotice";

const limitShown = () => notices.shown.some((notice) => /reached a limit/.test(notice.message));

beforeEach(() => {
  localStorage.clear();
  notices.shown = [];
  useAccountNotSetUp.setState({ notSetUp: true, hasDevices: false });
});
afterEach(cleanup);

it("says an account reached its limit once, even after a restart", () => {
  const first = render(<AccountSuspendedNotice />);
  expect(limitShown()).toBe(true);
  act(() => notices.shown[notices.shown.length - 1]!.onDismiss!());
  first.unmount();

  notices.shown = [];
  render(<AccountSuspendedNotice />);
  expect(limitShown()).toBe(false);
});

it("says so again if the account got devices and lost them", () => {
  localStorage.setItem("misty.account-not-set-up.dismissed.account", "1");
  useAccountNotSetUp.setState({ notSetUp: false, hasDevices: true });
  const first = render(<AccountSuspendedNotice />);
  first.unmount();

  notices.shown = [];
  useAccountNotSetUp.setState({ notSetUp: true, hasDevices: false });
  render(<AccountSuspendedNotice />);
  expect(limitShown()).toBe(true);
});
