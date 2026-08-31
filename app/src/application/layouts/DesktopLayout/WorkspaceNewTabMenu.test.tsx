import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigatorAppsStore } from "@/features/workspace";
import { createNewTabOptions, WorkspaceNewTabMenu } from "./WorkspaceNewTabMenu";

describe("WorkspaceNewTabMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useNavigatorAppsStore.setState({
      appIdsByAccount: { guest: ["inbox", "social", "planner", "browser"] },
      collapsedByAccount: {},
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[data-slot="dropdown-menu-content"]')
      .forEach((node) => node.remove());
    container.remove();
  });

  it("shows apps only in a non-scrolling grid", async () => {
    const onOpenNewTab = vi.fn();
    await act(async () => {
      root.render(<WorkspaceNewTabMenu paneId="pane-1" onOpenNewTab={onOpenNewTab} />);
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="New tab"]')
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const menu = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(menu).not.toBeNull();
    expect(menu?.className).toContain("gap-1");
    expect(menu?.style.maxHeight).toBe("none");
    expect(menu?.style.overflow).toBe("visible");
    expect(menu?.textContent).toContain("Apps");
    expect(menu?.textContent).not.toContain("Family");
    expect(
      [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Inbox", "Social", "Planner", "Browser"]);
    expect(menu?.textContent).not.toContain("Home");
    expect(menu?.textContent).not.toContain("Journal");
    expect(menu?.textContent).toContain("Planner");
    expect(menu?.textContent).toContain("Social");
    expect(menu?.textContent).not.toContain("Library");
    expect(menu?.textContent).not.toContain("Transfers");
    expect(menu?.textContent).not.toContain("Extensions");
    expect(menu?.querySelectorAll(".grid.grid-cols-2")).toHaveLength(1);

    const browser = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
      (item) => item.textContent === "Browser",
    );
    expect(browser?.className).toContain("py-1");
    expect(browser?.className).not.toContain("focus:text-cream");
    await act(async () => browser?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Browser", route: "/browser" }),
      "pane-1",
    );
  });

  it("opens from the keyboard and focuses the first destination", async () => {
    await act(async () => {
      root.render(<WorkspaceNewTabMenu paneId="pane-1" onOpenNewTab={vi.fn()} />);
    });
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="New tab"]');
    trigger?.focus();

    await act(async () => {
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    expect(document.activeElement?.textContent).toBe("Inbox");
  });

  it("shows a useful empty state when every app is disabled", async () => {
    useNavigatorAppsStore.setState({ appIdsByAccount: { guest: [] } });
    await act(async () => {
      root.render(<WorkspaceNewTabMenu paneId="pane-1" onOpenNewTab={vi.fn()} />);
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="New tab"]')
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const menu = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(menu?.querySelector('[role="menuitem"]')).toBeNull();
    expect(menu?.textContent).toContain("No apps enabled. Add apps from the sidebar.");
  });

  it("resolves every Space app against the active Space", () => {
    const options = createNewTabOptions({ spaceId: "space one", accountId: "account-1" });

    expect(options.map((option) => option.appId)).toEqual([
      "inbox",
      "social",
      "journal",
      "files",
      "agents",
      "planner",
      "library",
      "browser",
      "code",
      "terminal",
    ]);
    expect(options.find((option) => option.appId === "social")?.route).toBe(
      "/spaces/space%20one/social/misty",
    );
    expect(options.find((option) => option.appId === "journal")?.route).toBe(
      "/spaces/space%20one/notes",
    );
    expect(options.find((option) => option.appId === "planner")?.route).toBe(
      "/spaces/space%20one/planner/tasks/board",
    );
    expect(options.find((option) => option.appId === "library")?.route).toBe(
      "/spaces/space%20one/library",
    );
  });
});
