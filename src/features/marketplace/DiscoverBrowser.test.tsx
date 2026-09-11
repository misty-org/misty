import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficialAppDetails } from "@/features/apps/OfficialAppDetails";
import { useState } from "react";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { DiscoverBrowser, type DiscoverBrowserProps } from "./components/DiscoverBrowser";

const catalog: OfficialApp[] = [
  { id: "chat", name: "Chat", description: "Conversations with people and agents." },
  { id: "journal", name: "Journal", description: "Notes and drawings." },
  { id: "browser", name: "Browser", description: "Browse the web in your workspace." },
  { id: "terminal", name: "Terminal", description: "Run commands on your computer." },
].map((app) => ({
  ...app,
  publisher: "Misty",
  repository_url: "https://github.com/misty-org/misty-apps",
  about: "A useful app alongside your work.",
  version: "1.0.0",
  permission_version: 2,
  minimum_host_protocol: 2,
  official: true,
  age_rating: "4+",
  scopes: ["files.read"],
  desktop: { runtime: "downloaded" },
  mobile: { runtime: app.id === "terminal" ? "unsupported" : "hosted" },
}));
const installed: SpaceAppInstallation = {
  app_id: "browser",
  state: "installed",
  space_id: "space-a",
  authority_generation: 1,
  installed_version: "1.0.0",
  permission_version: 2,
  granted_scopes: ["files.read"],
  pinned: false,
  pin_rank: 0,
  installed_at: "2026-09-04",
  updated_at: "2026-09-04",
};

function setup(overrides: Partial<DiscoverBrowserProps> = {}) {
  const props: DiscoverBrowserProps = {
    catalog,
    installations: [installed],
    loading: false,
    ready: true,
    error: "",
    actionAppId: "",
    mobile: false,
    selectedAppId: "",
    onSelect: vi.fn(),
    onRefresh: vi.fn(),
    onInstall: vi.fn(),
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  function Host() {
    const [selectedAppId, onSelect] = useState(props.selectedAppId);
    return <DiscoverBrowser {...props} selectedAppId={selectedAppId} onSelect={onSelect} />;
  }
  render(<Host />);
  return props;
}

afterEach(cleanup);

describe("Discover compact catalog", () => {
  it("opens the requested app directly at permissions in Discover", () => {
    setup({ selectedAppId: "browser", reviewPermissions: true });
    expect(screen.getByRole("heading", { name: "App permissions" })).toBeTruthy();
    expect(screen.getByText(/Review the permissions Browser needs/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the approved navigation and filters the live catalog by category", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Discover sections" });
    expect(within(nav).getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByText("Settings")).toBeNull();
    expect(within(nav).getByRole("button", { name: "Extensions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Creative" }));
    expect(screen.getByRole("button", { name: "View Journal details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View Browser details" })).toBeNull();
  });

  it("shows the beta coming-soon state for Extensions", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    expect(screen.getByRole("heading", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Coming soon…" })).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh Discover" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View Journal details" })).toBeNull();
    expect(screen.queryByRole("group", { name: "App categories" })).toBeNull();
  });

  it("combines filters, keeps the menu open, and resets the catalog", () => {
    setup({ installations: [{ ...installed, installed_version: "0.9.0" }] });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "iPhone and iPad" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Downloaded" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Updates available" }));
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Updates available" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "View Browser details" })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Creative" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.getByText("No apps found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Filter" }).hasAttribute("data-active")).toBe(false);
  });

  it("filters compatibility and synchronizes the category tabs with the menu", () => {
    setup();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "iPhone and iPad" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "View Terminal details" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Creative" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen.getByRole("menuitemradio", { name: "Creative" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset filters" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(4);
  });

  it("sorts and filters the catalog through the toolbar menus", () => {
    setup();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort by" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Name: off" }));
    expect(screen.getByRole("menuitem", { name: "Name: ascending" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Name: ascending" }));
    expect(screen.getByRole("menuitem", { name: "Name: descending" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Name: descending" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Name: off" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(
      screen.getAllByRole("button", { name: /^View .* details$/ })[0].getAttribute("aria-label"),
    ).toBe("View Browser details");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Added to this Space" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "View Browser details" })).toBeTruthy();
  });

  it("searches the displayed Social name and restores results when cleared", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Discover" }), {
      target: { value: "Social" },
    });
    expect(screen.getByRole("button", { name: "View Social details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View Journal details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(4);
  });

  it("honors the Installed section requested by an update notice", () => {
    setup({ requestedSection: "installed" });
    expect(screen.getByRole("heading", { name: "Downloaded" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "View Browser details" })).toBeTruthy();
  });

  it("shows installed apps and opens details without launching or changing them", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Downloaded" }));
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Manage Browser" }));
    expect(screen.getByRole("dialog", { name: "Browser" })).toBeTruthy();
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("shows metadata above About and installs only after a separate Agree step", async () => {
    const props = setup();
    const trigger = screen.getByRole("button", { name: "Get Journal" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Journal" });
    const ui = within(dialog);
    expect(ui.getByText("Author")).toBeTruthy();
    expect(ui.getByText("Version")).toBeTruthy();
    expect(ui.getByRole("link", { name: "misty-org/misty-apps" }).getAttribute("href")).toBe(
      catalog[1].repository_url,
    );
    expect(ui.queryByText("Where it appears")).toBeNull();
    expect(ui.queryByText("Age rating")).toBeNull();
    expect(ui.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(ui.queryByText(/Read files/)).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    expect(props.onInstall).not.toHaveBeenCalled();
    expect(ui.getByRole("heading", { name: "App permissions" })).toBeTruthy();
    expect(ui.getByText("Read files and folders you choose.")).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(ui.getByRole("heading", { name: "Journal" })).toBeTruthy());
    expect(props.onInstall).toHaveBeenCalledExactlyOnceWith(catalog[1]);
    fireEvent.click(ui.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("requires new consent when an update adds access", async () => {
    const changed = { ...catalog[2], scopes: ["files.read", "files.write"] };
    const props = setup({ catalog: [changed] });
    fireEvent.click(screen.getByRole("button", { name: "Get Browser" }));
    const ui = within(screen.getByRole("dialog"));
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    expect(ui.getByText("New access")).toBeTruthy();
    expect(props.onInstall).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(props.onInstall).toHaveBeenCalledExactlyOnceWith(changed));
  });

  it.each([
    { space_id: "space-a", authority_generation: 1, installed_version: "0.9.0" },
    { permission_version: 1 },
  ])("uses Install without renewed consent when access is unchanged (%j)", async (previous) => {
    const props = setup({ installations: [{ ...installed, ...previous }] });
    fireEvent.click(screen.getByRole("button", { name: "Get Browser" }));
    expect(props.onInstall).not.toHaveBeenCalled();
    const ui = within(screen.getByRole("dialog"));
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(props.onInstall).toHaveBeenCalledWith(catalog[2]));
    expect(ui.queryByRole("button", { name: "Agree" })).toBeNull();
  });

  it("explains recovery and requests consent before reinstalling", async () => {
    const props = setup({
      installations: [{ ...installed, app_id: "journal", state: "recoverable" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Get Journal" }));
    const ui = within(screen.getByRole("dialog"));
    expect(ui.getByText(/restores its recoverable saved data/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    expect(props.onInstall).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(props.onInstall).toHaveBeenCalledWith(catalog[1]));
  });

  it("blocks unknown permissions without exposing scope identifiers", () => {
    const props = setup({ catalog: [{ ...catalog[1], scopes: ["unknown.secret"] }] });
    fireEvent.click(screen.getByRole("button", { name: "Get Journal" }));
    const ui = within(screen.getByRole("dialog"));
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    expect(ui.getByRole("alert").textContent).toContain("cannot describe");
    expect(ui.queryByText(/unknown.secret/)).toBeNull();
    expect((ui.getByRole("button", { name: "Agree" }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("discards stale consent when the catalog changes while permissions are open", () => {
    const onInstall = vi.fn();
    const props = {
      app: catalog[1],
      actionAppId: "",
      mobile: false,
      error: "",
      onClose: vi.fn(),
      onRestoreFocus: vi.fn(),
      onInstall,
      onRemove: vi.fn(),
    };
    const view = render(<OfficialAppDetails {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(screen.getByRole("button", { name: "Agree" })).toBeTruthy();
    const changed = { ...catalog[1], scopes: ["files.read", "files.write"] };
    view.rerender(<OfficialAppDetails {...props} app={changed} />);
    expect(screen.queryByRole("button", { name: "Agree" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(
      screen.getByText("Create, change, rename, and delete files and folders you choose."),
    ).toBeTruthy();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("dismisses a pending install without starting it twice", async () => {
    let complete!: () => void;
    const onInstall = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    setup({ selectedAppId: "journal", onInstall });
    const ui = within(screen.getByRole("dialog"));
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    expect(ui.getByRole("status").textContent).toBe("Installing…");
    fireEvent.click(ui.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => complete());
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("keeps failed installs on permissions and allows retry", async () => {
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error("Download failed"))
      .mockResolvedValue(undefined);
    setup({ onInstall: install, selectedAppId: "journal" });
    const ui = within(screen.getByRole("dialog"));
    fireEvent.click(ui.getByRole("button", { name: "Install" }));
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(ui.getByRole("alert").textContent).toBe("Download failed"));
    fireEvent.click(ui.getByRole("button", { name: "Agree" }));
    await waitFor(() => expect(ui.getByRole("heading", { name: "Journal" })).toBeTruthy());
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("uses catalog-backed previews that open details and disappear while filtering", () => {
    const props = setup();
    expect(screen.queryByRole("button", { name: "Preview Library" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview Journal" }));
    expect(screen.getByRole("dialog", { name: /Journal/ })).toBeTruthy();
    expect(props.onInstall).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Journal" } });
    expect(screen.queryByRole("button", { name: "Preview Journal" })).toBeNull();
    expect(screen.getByRole("button", { name: "View Journal details" })).toBeTruthy();
  });

  it("keeps unavailable apps inspectable while blocking installation", () => {
    const props = setup({ mobile: true });
    expect(
      (screen.getByRole("button", { name: "Unavailable Terminal" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "View Terminal details" }));
    const action = within(screen.getByRole("dialog")).getByRole("button", { name: "Install" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("offers removal from details and prevents concurrent operations", () => {
    const props = setup({ selectedAppId: "browser" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Uninstall" }));
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Uninstall Browser?" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Uninstall" }));
    expect(props.onRemove).toHaveBeenCalledWith(catalog[2]);
    cleanup();
    setup({ selectedAppId: "browser", actionAppId: "journal" });
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Uninstall",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("makes empty results recoverable and exposes refresh failures", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no match" } });
    expect(screen.getByText("No apps found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(4);
    cleanup();
    const props = setup({ catalog: [], ready: false, error: "Catalog unavailable" });
    expect(screen.getByRole("alert").textContent).toContain("Catalog unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });
});
