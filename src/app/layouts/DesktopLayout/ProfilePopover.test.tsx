import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePopover } from "./ProfilePopover";

let mockUser: { id: string; email: string; name: string } | null = {
  id: "account-1",
  email: "owner@example.com",
  name: "Owner",
};

let mockAccounts: Array<{ id: string; email: string; name: string }> = [];

vi.mock("@/features/auth", () => ({
  useAuth: () => ({
    user: mockUser,
    accounts: mockAccounts,
    transitioning: false,
    switchAccount: vi.fn(),
    logout: vi.fn(),
  }),
  useUserStore: (selector: (state: { me: null }) => unknown) => selector({ me: null }),
}));

vi.mock("@/features/installer", () => ({
  useSetupStore: (selector: (state: { status: null }) => unknown) => selector({ status: null }),
}));

describe("ProfilePopover", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockUser = { id: "account-1", email: "owner@example.com", name: "Owner" };
    mockAccounts = [];
  });

  it("uses the shell overlay, dismisses outside, and restores trigger focus", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.id = "misty-shell-overlays";
    const anchor = document.createElement("button");
    document.body.append(host, overlay, anchor);
    const root = createRoot(host);
    const anchorRef = { current: anchor };
    const onClose = vi.fn();
    const render = (open: boolean) =>
      root.render(
        <MemoryRouter>
          <ProfilePopover
            anchorRef={anchorRef}
            currentPath="/spaces"
            open={open}
            onClose={onClose}
            onOpenAccountSettings={vi.fn()}
          />
        </MemoryRouter>,
      );

    await act(async () => render(true));
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(overlay.querySelector('[role="menu"][aria-label="Profile"]')).not.toBeNull();
    expect((document.activeElement as HTMLElement | null)?.getAttribute("role")).toBe("menuitem");

    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => render(false));
    expect(document.activeElement).toBe(anchor);
    await act(async () => root.unmount());
  });

  it("opens cleanly after being mounted closed without hook count mismatch", async () => {
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.id = "misty-shell-overlays";
    const anchor = document.createElement("button");
    document.body.append(host, overlay, anchor);
    const root = createRoot(host);
    const anchorRef = { current: anchor };
    const render = (open: boolean) =>
      root.render(
        <MemoryRouter>
          <ProfilePopover
            anchorRef={anchorRef}
            currentPath="/spaces"
            open={open}
            onClose={vi.fn()}
            onOpenAccountSettings={vi.fn()}
          />
        </MemoryRouter>,
      );

    await act(async () => render(false));
    expect(overlay.querySelector('[role="menu"][aria-label="Profile"]')).toBeNull();

    await act(async () => render(true));
    expect(overlay.querySelector('[role="menu"][aria-label="Profile"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("omits Report a problem and matches navbar icon sizing", async () => {
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.id = "misty-shell-overlays";
    const anchor = document.createElement("button");
    document.body.append(host, overlay, anchor);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ProfilePopover
            anchorRef={{ current: anchor }}
            currentPath="/spaces"
            open
            onClose={vi.fn()}
            onOpenAccountSettings={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    expect(overlay.textContent).not.toContain("Report a problem");
    for (const label of ["Account settings", "Switch accounts", "Log out"]) {
      const button = Array.from(overlay.querySelectorAll("button")).find((candidate) =>
        candidate.textContent?.includes(label),
      );
      const leadingIcon = button?.querySelector("svg");
      expect(leadingIcon?.getAttribute("width")).toBe("18");
      expect(leadingIcon?.getAttribute("height")).toBe("18");
      expect(leadingIcon?.getAttribute("stroke-width")).toBe("2");
    }
    await act(async () => root.unmount());
  });

  it("shows only Sign in button when no account is signed in", async () => {
    mockUser = null;
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.id = "misty-shell-overlays";
    const anchor = document.createElement("button");
    document.body.append(host, overlay, anchor);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ProfilePopover
            anchorRef={{ current: anchor }}
            currentPath="/spaces"
            open
            onClose={vi.fn()}
            onOpenAccountSettings={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    const signInButton = Array.from(overlay.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Sign in"),
    );
    expect(signInButton).toBeDefined();

    for (const label of ["Account settings", "Take app tour", "Switch accounts", "Log out"]) {
      const button = Array.from(overlay.querySelectorAll("button")).find((candidate) =>
        candidate.textContent?.includes(label),
      );
      expect(button).toBeUndefined();
    }
    await act(async () => root.unmount());
  });

  it("renders clean Switch accounts popover without extraneous subtext", async () => {
    mockAccounts = [
      { id: "account-1", email: "owner@example.com", name: "Owner" },
      { id: "account-2", email: "mattdev727@gmail.com", name: "Matt" },
    ];
    const host = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.id = "misty-shell-overlays";
    const anchor = document.createElement("button");
    document.body.append(host, overlay, anchor);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ProfilePopover
            anchorRef={{ current: anchor }}
            currentPath="/spaces"
            open
            onClose={vi.fn()}
            onOpenAccountSettings={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    const switchAccountsButton = Array.from(overlay.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Switch accounts"),
    );
    expect(switchAccountsButton).toBeDefined();

    await act(async () => {
      switchAccountsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const accountChooser = overlay.querySelector('[role="menu"][aria-label="Switch accounts"]');
    expect(accountChooser).not.toBeNull();

    // Verify main header and options are present
    expect(accountChooser?.textContent).toContain("Switch accounts");
    expect(accountChooser?.textContent).toContain("Owner");
    expect(accountChooser?.textContent).toContain("Matt");
    expect(accountChooser?.textContent).toContain("Add another account");

    // Verify subtext is removed
    expect(accountChooser?.textContent).not.toContain("Your saved Misty sessions");
    expect(accountChooser?.textContent).not.toContain("Accounts remain signed in securely");
    expect(accountChooser?.textContent).not.toContain("mattdev727@gmail.com");

    await act(async () => root.unmount());
  });
});
