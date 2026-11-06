import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/features/settings", () => ({ preloadSettingsWorkspace: () => Promise.resolve() }));
vi.mock("./NavRail", () => ({
  AccountNavButton: (props: object) => (
    <button type="button" {...props}>
      Account
    </button>
  ),
}));
vi.mock("./AccountMenu", () => ({ AccountMenu: () => null }));

import { AccountIsland } from "./AccountIsland";

afterEach(cleanup);

function renderRow(props: { signedOut?: boolean; sessionExpired?: boolean }) {
  const onSignIn = vi.fn();
  render(
    <AccountIsland
      open={false}
      onOpenChange={vi.fn()}
      onOpenAccountSettings={vi.fn()}
      settingsOpen={false}
      onSettingsClick={vi.fn()}
      onSignIn={onSignIn}
      {...props}
    />,
  );
  return onSignIn;
}

it("reads Sign in while signed out, with no account button", () => {
  const onSignIn = renderRow({ signedOut: true });
  expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(onSignIn).toHaveBeenCalledWith(false);
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

it("shows the account button while signed in, and no Sync button", () => {
  renderRow({});
  expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("removes the account and says to sign in when the session expired", () => {
  const onSignIn = renderRow({ sessionExpired: true });
  expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  expect(screen.getByText(/You've been signed out/)).toBeTruthy();
  const [rowButton, noticeButton] = screen.getAllByRole("button", { name: "Sign in" });
  fireEvent.click(rowButton);
  expect(onSignIn).toHaveBeenLastCalledWith(true);
  fireEvent.click(noticeButton);
  expect(onSignIn).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/You've been signed out/)).toBeNull();
});
