import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesTopBar } from "./components/NotesTopBar";

describe("NotesTopBar", () => {
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

  it("renders search and the new note action", async () => {
    const onNewNote = vi.fn();

    await act(async () => {
      root.render(<NotesTopBar query="" onQueryChange={() => {}} onNewNote={onNewNote} />);
    });

    expect(container.textContent).toContain("New note");
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("New note"),
    );
    await act(async () => button?.click());
    expect(onNewNote).toHaveBeenCalledOnce();
  });
});
