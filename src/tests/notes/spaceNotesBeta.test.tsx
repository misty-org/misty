import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "account-beta" } }),
}));

vi.mock("@/features/notes/components/NoteBlockEditor", () => ({
  default: ({ editable }: { editable: boolean }) => (
    <div data-testid="block-editor" data-editable={String(editable)} />
  ),
}));

import { SpaceNotes } from "@/features/notes/SpaceNotes";
import { NotesPanelSidebar } from "@/features/notes/components/NotesPanelSidebar";
import { useNotesStore } from "@/stores/notes";
import { resetNotesAccountState } from "@/stores/notes/useNotesStore";
import type { UnifiedNote } from "@/models/types/features/notes/types";

function note(overrides: Partial<UnifiedNote> & { id: string }): UnifiedNote {
  const { id, ...rest } = overrides;
  return {
    id,
    source: "misty",
    sourceId: id,
    title: "Title",
    body: "",
    bodyFormat: "markdown",
    preview: "",
    spaceId: "space-product",
    spaceName: "Product",
    tags: [],
    backlinks: [],
    updatedAt: "2026-07-20T12:00:00.000Z",
    createdAt: "2026-07-20T12:00:00.000Z",
    favorite: false,
    syncStatus: "local-only",
    ...rest,
  };
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

async function wait(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("SpaceNotes beta simplification", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    resetNotesAccountState();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    if (container) container.remove();
    document.body.replaceChildren();
    resetNotesAccountState();
  });

  it("does not render Notion or source-management UI in the beta notes surface", async () => {
    await act(async () => {
      root.render(<SpaceNotes spaceId="space-product" spaceName="Product" />);
    });
    await wait(180);

    expect(document.body.textContent).not.toContain("Notion");
    expect(document.body.textContent).not.toContain("Sources");
    expect(document.body.textContent).not.toContain("Manage sources");
    expect(document.body.textContent).not.toContain("Publish to Notion");
    expect(document.body.textContent).not.toContain("Open in Notion");
    expect(document.body.textContent).not.toContain("Unlinked");
    expect(document.body.textContent).not.toContain(
      "Misty notes are saved privately on this desktop and belong to this Space.",
    );
  });

  it("renders the active Space note list in the Space panel sidebar", async () => {
    useNotesStore.setState({
      phase: "ready",
      notes: [
        note({ id: "note-product", title: "Product note" }),
        note({ id: "note-platform", title: "Platform note", spaceId: "space-platform" }),
      ],
      selectedNoteId: "note-product",
    });

    await act(async () => {
      root.render(<NotesPanelSidebar spaceId="space-product" spaceName="Product" />);
    });

    expect(document.body.textContent).toContain("Product");
    expect(document.body.textContent).toContain("Product note");
    expect(document.body.textContent).not.toContain("Platform note");
  });

  it("creates a title-only Space note and opens it directly in edit mode", async () => {
    await act(async () => {
      root.render(<SpaceNotes spaceId="space-product" spaceName="Product" />);
    });
    await wait(180);

    await act(async () => {
      buttonByText("New note").click();
    });

    expect(document.body.textContent).toContain("New note");
    expect(document.body.textContent).toContain("Title");
    expect(document.body.querySelector("#new-note-body")).toBeNull();
    expect(document.body.querySelector("#new-note-space")).toBeNull();

    const input = document.body.querySelector<HTMLInputElement>("#new-note-title");
    expect(input).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "Beta note");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      buttonByText("Create note").click();
    });
    await wait(160);
    await wait();

    const created = useNotesStore.getState().notes.find((note) => note.title === "Beta note");
    expect(created).toMatchObject({
      body: "",
      spaceId: "space-product",
      spaceName: "Product",
    });
    expect(useNotesStore.getState().selectedNoteId).toBe(created?.id);
    expect(document.body.textContent).toContain("Beta note");
    expect(
      document.body.querySelector("[data-testid='block-editor']")?.getAttribute("data-editable"),
    ).toBe("true");
  });
});
