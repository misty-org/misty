import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { OfficialApp, UserAppInstallation } from "@/api/apps";
import { DiscoverBrowser, type DiscoverBrowserProps } from "./components/DiscoverBrowser";

const catalog: OfficialApp[] = [
  { id: "chat", name: "Chat", description: "Conversations with people and agents." },
  { id: "journal", name: "Journal", description: "Notes and drawings." },
  { id: "browser", name: "Browser", description: "Browse the web in your workspace." },
  { id: "terminal", name: "Terminal", description: "Run commands on your computer." },
].map((app) => ({
  ...app,
  publisher: "Misty",
  version: "1.0.0",
  permission_version: 2,
  minimum_host_protocol: 2,
  official: true,
  age_rating: "4+",
  scopes: ["files.read"],
  desktop: { runtime: "downloaded" },
  mobile: { runtime: app.id === "terminal" ? "unsupported" : "hosted" },
}));
const installed: UserAppInstallation = {
  app_id: "browser",
  state: "installed",
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
  it("shows the approved navigation and filters the live catalog by category", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Discover sections" });
    expect(within(nav).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Extensions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Creative 1" }));
    expect(screen.getByRole("button", { name: "View Journal details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View Browser details" })).toBeNull();
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

  it("shows only installed apps and opens them without an install", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Installed 1 installed apps/ }));
    expect(screen.getAllByRole("button", { name: /^View .* details$/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open Browser" }));
    expect(props.onOpen).toHaveBeenCalledWith(catalog[2]);
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("opens a details dialog and requires an explicit permissions confirmation to install", async () => {
    const props = setup();
    const trigger = screen.getByRole("button", { name: "Add Journal" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /Journal/ });
    expect(within(dialog).getByText("Read files and folders you choose")).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "About" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Where it appears" })).toBeTruthy();
    expect(props.onInstall).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to Misty" }));
    expect(props.onInstall).toHaveBeenCalledWith(catalog[1]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("routes an outdated installation through review instead of opening it", () => {
    const props = setup({ installations: [{ ...installed, permission_version: 1 }] });
    fireEvent.click(screen.getByRole("button", { name: "Review Browser" }));
    expect(screen.queryByRole("button", { name: "Open Browser" })).toBeNull();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Approve update" }),
    );
    expect(props.onInstall).toHaveBeenCalledWith(catalog[2]);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("uses Update for a version-only change and still requires confirmation", () => {
    const props = setup({ installations: [{ ...installed, installed_version: "0.9.0" }] });
    fireEvent.click(screen.getByRole("button", { name: "Update Browser" }));
    expect(props.onInstall).not.toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));
    expect(props.onInstall).toHaveBeenCalledWith(catalog[2]);
  });

  it("labels recovery Add and explains saved data before confirming", () => {
    const props = setup({
      installations: [{ ...installed, app_id: "journal", state: "recoverable" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Journal" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/restores its recoverable saved data/)).toBeTruthy();
    expect(screen.queryByText("Add again")).toBeNull();
    expect(props.onInstall).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to Misty" }));
    expect(props.onInstall).toHaveBeenCalledWith(catalog[1]);
  });

  it("uses catalog-backed previews that open details and disappear while filtering", () => {
    const props = setup();
    expect(screen.queryByRole("button", { name: "Preview Library" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview Journal" }));
    expect(screen.getByRole("dialog", { name: /Journal/ })).toBeTruthy();
    expect(props.onInstall).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
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
    const action = within(screen.getByRole("dialog")).getByRole("button", { name: "Unavailable" });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("offers removal from details and prevents concurrent operations", () => {
    const props = setup({ selectedAppId: "browser" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove app" }));
    expect(props.onRemove).toHaveBeenCalledWith(catalog[2]);
    cleanup();
    setup({ selectedAppId: "browser", actionAppId: "journal" });
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Remove app",
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
