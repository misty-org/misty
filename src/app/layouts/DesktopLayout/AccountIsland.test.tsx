import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const agents = vi.hoisted(() => ({ openSignInSheet: vi.fn() }));

vi.mock("@/features/agents", () => ({
  useMistyPanelStore: (select: (state: { chatOpen: boolean }) => boolean) =>
    select({ chatOpen: false }),
}));
vi.mock("@/features/account", () => ({ openSignInSheet: agents.openSignInSheet }));
vi.mock("@/features/settings", () => ({ preloadSettingsWorkspace: () => Promise.resolve() }));
vi.mock("./NavRail", () => ({
  AccountNavButton: (props: object) => (
    <button type="button" {...props}>
      Account
    </button>
  ),
}));
vi.mock("./AccountMenu", () => ({ AccountMenu: () => null }));

import { NoticeViewport } from "@/shared/ui";
import { AccountIsland } from "./AccountIsland";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(props: { sessionExpired?: boolean }) {
  const onSignIn = vi.fn();
  render(
    <>
      <NoticeViewport />
      <AccountIsland
        open={false}
        onOpenChange={vi.fn()}
        onOpenAccountSettings={vi.fn()}
        settingsOpen={false}
        onSettingsClick={vi.fn()}
        onSignIn={onSignIn}
        {...props}
      />
    </>,
  );
  return onSignIn;
}

it("shows the account button while signed in, and no Sync button", () => {
  renderRow({});
  expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("removes the account and says to sign in while the session is expired", async () => {
  const onSignIn = renderRow({ sessionExpired: true });
  expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  expect(await screen.findByText(/You've been signed out/)).toBeTruthy();
  const [rowButton, noticeButton] = screen.getAllByRole("button", { name: "Sign in" });
  fireEvent.click(rowButton);
  expect(onSignIn).toHaveBeenLastCalledWith(true);
  fireEvent.click(noticeButton);
  expect(onSignIn).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByText(/You've been signed out/)).toBeNull());
});
