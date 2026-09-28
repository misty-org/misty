import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui";
import { ProfileMenu } from "./ProfileMenu";

let mockUser: { id: string; email: string; name: string } | null = {
  id: "account-1",
  email: "owner@example.com",
  name: "Owner",
};
let mockAccounts: Array<{ id: string; email: string; name: string }> = [];

vi.mock("@/features/auth", () => ({
  SavedAccountSessionUnavailableError: class extends Error {},
  useAuth: () => ({
    user: mockUser,
    accounts: mockAccounts,
    transitioning: false,
    switchAccount: vi.fn(),
    logout: vi.fn(async () => {}),
  }),
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));

vi.mock("@/features/installer", () => ({
  useSetupStore: (selector: (state: { status: null }) => unknown) => selector({ status: null }),
}));

function renderMenu() {
  return render(
    <MemoryRouter>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>Profile</DropdownMenuTrigger>
        <ProfileMenu onClose={vi.fn()} onOpenAccountSettings={vi.fn()} />
      </DropdownMenu>
    </MemoryRouter>,
  );
}

describe("ProfileMenu", () => {
  afterEach(() => {
    cleanup();
    mockUser = { id: "account-1", email: "owner@example.com", name: "Owner" };
    mockAccounts = [];
  });

  it("lists account actions for a signed-in account", () => {
    renderMenu();
    const menu = screen.getByRole("menu", { name: "Profile" });
    expect(menu.textContent).toContain("owner@example.com");
    for (const label of [/Account settings/, /Switch accounts/, /Log out/]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    expect(menu.textContent).not.toContain("Report a problem");
  });

  it("offers only Sign in when no account is signed in", () => {
    mockUser = null;
    renderMenu();
    expect(screen.getByRole("menuitem", { name: "Sign in" })).toBeTruthy();
    for (const label of [/Account settings/, /Switch accounts/, /Log out/]) {
      expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
    }
  });

  it("switches between saved accounts without extra subtext", () => {
    mockAccounts = [
      { id: "account-1", email: "owner@example.com", name: "Owner" },
      { id: "account-2", email: "second@example.com", name: "Matt" },
    ];
    renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Switch accounts/ }));
    const menus = screen.getAllByRole("menu");
    const chooser = menus[menus.length - 1]!;
    expect(chooser.textContent).toContain("Owner");
    expect(chooser.textContent).toContain("Matt");
    expect(chooser.textContent).toContain("Add another account");
    expect(chooser.textContent).not.toContain("second@example.com");
  });
});
