import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileNavigation, mobileNavigationIcons } from "./MobileNavigation";

const baseProps = {
  activePath: "/home",
  activeSpaceId: "",
  spaces: [],
  core: [],
  more: [],
  moreOpen: true,
  onMoreOpenChange: vi.fn(),
  onNavigate: vi.fn(),
  onSelectSpace: vi.fn(),
};

describe("MobileNavigation account entry", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers sign in when there is no active account", () => {
    const onAccount = vi.fn();

    render(<MobileNavigation {...baseProps} account={null} onAccount={onAccount} />);

    expect(screen.getAllByText("Sign in to Misty").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sync your Spaces and conversations").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /sign in to misty/i })[0]);
    expect(onAccount).toHaveBeenCalledOnce();
  });

  it("shows the active profile identity", () => {
    render(
      <MobileNavigation
        {...baseProps}
        account={{ name: "Ada Lovelace", email: "ada@example.com" }}
        onAccount={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ada@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
  });

  it("keeps the phone navigation fixed to Home, Apps, and Store", () => {
    render(
      <MobileNavigation
        {...baseProps}
        core={[
          { id: "home", label: "Home", path: "/home", icon: mobileNavigationIcons.home },
          { id: "apps", label: "Apps", path: "/apps", icon: mobileNavigationIcons.apps },
          { id: "store", label: "Store", path: "/store", icon: mobileNavigationIcons.store },
        ]}
        account={null}
        onAccount={vi.fn()}
      />,
    );

    const phoneNav = screen.getByRole("navigation", { name: "Mobile primary" });
    expect(phoneNav.textContent).toBe("HomeAppsStore");
    expect(phoneNav.textContent).not.toContain("More");
  });
});
