import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/features/settings", () => ({ preloadSettingsWorkspace: () => Promise.resolve() }));
vi.mock("./NavRail", () => ({
  ProfileNavButton: (props: object) => (
    <button type="button" {...props}>
      Profile
    </button>
  ),
}));
vi.mock("./ProfileMenu", () => ({ ProfileMenu: () => null }));

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
      sync={<button type="button">Sync</button>}
      {...props}
    />,
  );
  return onSignIn;
}

it("reads Sign in while signed out, with no Profile or Sync", () => {
  const onSignIn = renderRow({ signedOut: true });
  expect(screen.queryByRole("button", { name: "Profile" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(onSignIn).toHaveBeenCalledWith(false);
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

it("shows the profile and Sync while signed in", () => {
  renderRow({});
  expect(screen.getByRole("button", { name: "Profile" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sync" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("swaps Sync for Sign in again when the session expired", () => {
  const onSignIn = renderRow({ sessionExpired: true });
  expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
  expect(onSignIn).toHaveBeenCalledWith(true);
});
