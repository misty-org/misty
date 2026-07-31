import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesTopBar } from "@/features/notes/components/NotesTopBar";
import { spacesBottomBarActionsId } from "@/features/spaces/components/SpacesBottomBar";

describe("NotesTopBar", () => {
  let container: HTMLDivElement;
  let bottomBarActions: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    bottomBarActions = document.createElement("div");
    bottomBarActions.id = spacesBottomBarActionsId;
    document.body.append(container, bottomBarActions);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    bottomBarActions.remove();
  });

  it("renders the details toggle in the Spaces bottom bar", async () => {
    const onToggleContextPanel = vi.fn();

    await act(async () => {
      root.render(
        <NotesTopBar
          query=""
          contextPanelOpen
          contextPanelAvailable
          onQueryChange={() => {}}
          onNewNote={() => {}}
          onToggleContextPanel={onToggleContextPanel}
        />,
      );
    });

    expect(container.querySelector('button[aria-label="Hide details"]')).toBeNull();
    expect(container.textContent).toContain("New note");

    const toggle = bottomBarActions.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide details"]',
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => toggle?.click());
    expect(onToggleContextPanel).toHaveBeenCalledOnce();
  });
});
