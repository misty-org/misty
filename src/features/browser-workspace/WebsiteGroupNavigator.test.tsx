import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { allLayoutViews, useWorkspaceStore } from "@/features/workspace";
import { addWebsite, createWebsiteGroup } from "./navigation";
import { WebsiteGroupNavigator } from "./WebsiteGroupNavigator";
import { SavedWebsiteIcon } from "./SavedWebsiteIcon";

beforeEach(() => {
  cleanup();
  useWorkspaceStore.getState().reset();
  createWebsiteGroup("Videos");
});

describe("saved website navigation", () => {
  it("opens a new global layout instead of changing or resuming a split panel", () => {
    const state = () => useWorkspaceStore.getState();
    const id = addWebsite(state().websiteGroups[0].id, "YouTube", "https://www.youtube.com/");
    state().openBrowserTab({ url: "https://www.youtube.com/", websiteId: id });
    const pane = state().splitPane(state().layout.focusedPaneId, "right")!;
    state().openBrowserTab({ url: "https://example.com/", paneId: pane });
    const previousLayoutId = state().layout.activeLayoutTabId;
    const previousRoot = state().layout.root;
    const previousIds = allLayoutViews(state().layout).map((tab) => tab.id);
    render(
      <MemoryRouter>
        <WebsiteGroupNavigator />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "YouTube" }));
    expect(state().activeScopeKey).toBe("global");
    expect(state().layout.activeLayoutTabId).not.toBe(previousLayoutId);
    expect(state().layout.root.type).toBe("leaf");
    expect(allLayoutViews(state().layout).length).toBe(previousIds.length + 1);
    expect(state().layout.tabs?.find((tab) => tab.id === previousLayoutId)?.root).toEqual(
      previousRoot,
    );
  });

  it("uses the official logo for saved YouTube URLs", () => {
    const { container } = render(
      <SavedWebsiteIcon url="https://www.youtube.com/watch?v=example" />,
    );
    expect(container.querySelector('[data-brand-icon="youtube"]')).not.toBeNull();
  });

  it("uses custom-site favicons and recovers from unavailable images", () => {
    const { container, rerender } = render(<SavedWebsiteIcon url="https://custom.example/path" />);
    const icon = container.querySelector("img")!;
    expect(icon.getAttribute("src")).toBe("https://custom.example/favicon.ico");
    fireEvent.error(icon);
    expect(container.querySelector("img")).toBeNull();
    rerender(<SavedWebsiteIcon url="https://other.example/" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://other.example/favicon.ico",
    );
  });
});
