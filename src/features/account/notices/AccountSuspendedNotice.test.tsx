import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAccountNotSetUp } from "@/api/client/accountLimits";

vi.mock("../sessions/authState", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("@/api/deployment/serverChoice", () => ({
  currentApiBase: () => "https://pro",
  mistyCloudServer: () => "https://pro",
  mistyWebsite: () => "https://site",
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/shared/ui", () => ({
  Button: (props: { children: React.ReactNode }) => <button>{props.children}</button>,
  Notification: (props: { children: React.ReactNode; onDismiss: () => void }) => (
    <div>
      {props.children}
      <button onClick={props.onDismiss}>Dismiss</button>
    </div>
  ),
}));

import { AccountSuspendedNotice } from "./AccountSuspendedNotice";

beforeEach(() => {
  localStorage.clear();
  useAccountNotSetUp.setState({ notSetUp: true, hasDevices: false });
});
afterEach(cleanup);

it("says an account has no Misty Pro once, even after a restart", () => {
  const first = render(<AccountSuspendedNotice />);
  expect(screen.getByText(/doesn.t have Misty Pro/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText(/doesn.t have Misty Pro/)).toBeNull();
  first.unmount();

  render(<AccountSuspendedNotice />);
  expect(screen.queryByText(/doesn.t have Misty Pro/)).toBeNull();
});

it("says so again if the account got devices and lost them", () => {
  localStorage.setItem("misty.account-not-set-up.dismissed.account", "1");
  useAccountNotSetUp.setState({ notSetUp: false, hasDevices: true });
  const first = render(<AccountSuspendedNotice />);
  first.unmount();

  useAccountNotSetUp.setState({ notSetUp: true, hasDevices: false });
  render(<AccountSuspendedNotice />);
  expect(screen.getByText(/doesn.t have Misty Pro/)).toBeTruthy();
});
