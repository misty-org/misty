import { NewTabMenu } from "./NewTabMenu";
import { FolderOpen, Inbox } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("NewTabMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows concise icon-and-label options", async () => {
    const openInbox = vi.fn();
    await act(async () => {
      root.render(
        <NewTabMenu
          ariaLabel="New Files tab"
          options={[
            { id: "current", label: "Current path", icon: FolderOpen, onSelect: vi.fn() },
            { id: "inbox", label: "Inbox", icon: Inbox, onSelect: openInbox },
          ]}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="New Files tab"]')
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    const options = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(options.map((option) => option.textContent)).toEqual(["Current path", "Inbox"]);
    expect(options.every((option) => option.querySelector("svg"))).toBe(true);

    await act(async () => {
      options
        .find((option) => option.textContent === "Inbox")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openInbox).toHaveBeenCalledOnce();
  });
});
