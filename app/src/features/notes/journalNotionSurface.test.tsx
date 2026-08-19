import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteReadingPane } from "./components/NoteReadingPane";
import type { UnifiedNote } from "./model/types/types";

vi.mock("./components/NoteBlockEditor", () => ({ default: () => <div>Note body</div> }));

describe("Journal Notion provenance and writes", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("attributes a Notion note and offers its source link", async () => {
    const onOpenInSource = vi.fn();
    await act(async () => {
      root.render(
        <NoteReadingPane
          note={note({ source: "notion", syncStatus: "synced" })}
          loading={false}
          onNewNote={vi.fn()}
          onOpenInSource={onOpenInSource}
        />,
      );
    });

    expect(container.textContent).toContain("Notion");
    const button = buttonNamed(container, "Open in Notion");
    expect(button).toBeDefined();
    await click(button);
    expect(onOpenInSource).toHaveBeenCalledWith("note-1");
  });

  it("publishes a native note only after the explicit user action", async () => {
    const onPublish = vi.fn();
    await act(async () => {
      root.render(
        <NoteReadingPane
          note={note({ source: "misty", syncStatus: "local-only" })}
          loading={false}
          onNewNote={vi.fn()}
          onPublish={onPublish}
        />,
      );
    });

    expect(onPublish).not.toHaveBeenCalled();
    await click(buttonNamed(container, "Publish to Notion"));
    expect(onPublish).toHaveBeenCalledWith("note-1");
  });
});

async function click(element: Element | undefined) {
  expect(element).toBeDefined();
  await act(async () => element!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  );
}

function note(overrides: Partial<UnifiedNote>): UnifiedNote {
  return {
    id: "note-1",
    source: "misty",
    sourceId: "note-1",
    title: "Launch notes",
    body: "Ship it",
    bodyFormat: "markdown",
    preview: "Ship it",
    spaceId: "space-1",
    spaceName: "Product",
    tags: [],
    backlinks: [],
    updatedAt: "2026-08-19T00:00:00Z",
    createdAt: "2026-08-19T00:00:00Z",
    favorite: false,
    syncStatus: "synced",
    ...overrides,
  };
}
