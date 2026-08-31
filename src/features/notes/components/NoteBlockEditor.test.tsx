import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteBlockEditor } from "./NoteBlockEditor";

vi.mock("../noteAssets", () => ({
  uploadNoteAsset: vi.fn(async () => "/api/spaces/space-one/notes/note_one/assets/asset_one"),
}));

describe("TipTap Journal editor", () => {
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

  it("keeps the Simple Editor command set without a theme switch", async () => {
    await act(async () => {
      root.render(
        <NoteBlockEditor
          editable
          noteId="note_one"
          spaceId="space-one"
          body="# Journal\n\nStart writing."
          bodyFormat="markdown"
        />,
      );
    });

    const toolbar = container.querySelector('[role="toolbar"][aria-label="Text formatting"]');
    expect(toolbar).not.toBeNull();
    for (const label of [
      "Undo",
      "Redo",
      "Headings",
      "Lists",
      "Blockquote",
      "Code block",
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Underline",
      "Highlight",
      "Link",
      "Superscript",
      "Subscript",
      "Align left",
      "Align center",
      "Align right",
      "Justify",
      "Search and replace",
    ]) {
      expect(toolbar?.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    expect(toolbar?.textContent).toContain("Add");
    expect(container.querySelector('[aria-label*="theme" i]')).toBeNull();
  });

  it("opens the retained find-and-replace controls", async () => {
    await act(async () => {
      root.render(
        <NoteBlockEditor editable noteId="note_one" body="Find this text" bodyFormat="markdown" />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Search and replace"]')?.click();
    });

    expect(container.querySelector('[aria-label="Find text"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Replacement text"]')).not.toBeNull();
    expect(container.textContent).toContain("Previous");
    expect(container.textContent).toContain("Replace");
  });
});
