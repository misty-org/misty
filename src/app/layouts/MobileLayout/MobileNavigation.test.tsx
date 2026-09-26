import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileNavigation, mobileNavigationIcons } from "./MobileNavigation";

const render = (node: ReactNode) => rtlRender(<MemoryRouter>{node}</MemoryRouter>);

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
    expect(screen.getAllByText("Your browser workspace across devices").length).toBeGreaterThan(0);

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

  it("keeps the phone navigation fixed to Home, Files, Agents, and a navigation menu", () => {
    render(
      <MobileNavigation
        {...baseProps}
        core={[
          { id: "home", label: "Home", path: "/home", icon: mobileNavigationIcons.home },
          { id: "files", label: "Files", path: "/files", icon: mobileNavigationIcons.files },
          { id: "agents", label: "Agents", path: "/agents", icon: mobileNavigationIcons.agents },
        ]}
        account={null}
        onAccount={vi.fn()}
      />,
    );

    const phoneNav = screen.getByRole("navigation", { name: "Mobile primary" });
    expect(phoneNav.textContent).toBe("HomeFilesAgentsMenu");
    fireEvent.click(within(phoneNav).getByRole("button", { name: "Files" }));
    expect(baseProps.onNavigate).toHaveBeenCalledWith("/files");
    fireEvent.click(within(phoneNav).getByRole("button", { name: "Menu" }));
    const menu = screen.getByRole("dialog", { name: "Workspace navigation" });
    expect(within(menu).getByRole("button", { name: "Configure groups" })).toBeTruthy();
    expect(within(menu).getByRole("link", { name: "Spaces" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: /sign in to misty/i })).toBeTruthy();
  });
});
