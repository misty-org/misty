import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-beta" } }),
}));

vi.mock("@/services/spaces/api", () => ({
  spaceRequest: spaceRequestMock,
}));

vi.mock("../components/NoteBlockEditor", () => ({
  default: ({
    collaborative,
    editable,
    noteId,
  }: {
    collaborative?: boolean;
    editable: boolean;
    noteId: string;
  }) => (
    <div
      data-testid="block-editor"
      data-collaborative={String(Boolean(collaborative))}
      data-editable={String(editable)}
      data-note-id={noteId}
    />
  ),
}));

import { SpaceNotes } from "../SpaceNotes";
import { NotesPanelSidebar } from "../components/NotesPanelSidebar";
import type { UnifiedNote } from "../model/types/types";
import { useNotesStore } from "../store";
import { resetNotesAccountState } from "../store/useNotesStore";

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
    spaceRequestMock.mockReset();
    spaceRequestMock.mockResolvedValue({ notes: [] });
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
    vi.useRealTimers();
  });

  const notesSurface = (entry = "/spaces/space-product/notes") => (
    <MemoryRouter initialEntries={[entry]}>
      <SpaceNotes spaceId="space-product" spaceName="Product" />
    </MemoryRouter>
  );

  it("does not render Notion or source-management UI in the beta notes surface", async () => {
    await act(async () => {
      root.render(notesSurface());
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

  it("opens the existing note dialog from a note creation query", async () => {
    await act(async () => {
      root.render(notesSurface("/spaces/space-product/notes?create=note"));
    });
    await wait();

    expect(document.body.textContent).toContain("New note");
    expect(document.body.querySelector("#new-note-title")).not.toBeNull();
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
      root.render(
        <MemoryRouter>
          <NotesPanelSidebar spaceId="space-product" spaceName="Product" />
        </MemoryRouter>,
      );
    });

    expect(document.body.textContent).toContain("Product");
    expect(document.body.textContent).toContain("Product note");
    expect(document.body.textContent).not.toContain("Platform note");
  });

  it("creates a title-only collaborative Space note and selects it", async () => {
    spaceRequestMock.mockResolvedValueOnce({ notes: [] }).mockResolvedValueOnce({
      id: "note_beta",
      space_id: "space-product",
      creator_user_id: "account-beta",
      title: "Beta note",
      plain_text: "",
      lifecycle_state: "active",
      collaboration_revision: 0,
      acl_version: 1,
      role: "creator",
      created_at: "2026-07-20T12:00:00.000Z",
      updated_at: "2026-07-20T12:00:00.000Z",
    });
    await act(async () => {
      root.render(notesSurface());
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
      syncStatus: "synced",
    });
    expect(useNotesStore.getState().selectedNoteId).toBe(created?.id);
    expect(document.body.textContent).toContain("Beta note");
    expect(
      document.body.querySelector("[data-testid='block-editor']")?.getAttribute("data-editable"),
    ).toBe("true");
    expect(
      document.body
        .querySelector("[data-testid='block-editor']")
        ?.getAttribute("data-collaborative"),
    ).toBe("true");
    expect(
      document.body.querySelector("[data-testid='block-editor']")?.getAttribute("data-note-id"),
    ).toBe("note_beta");
  });

  it("deletes a creator-owned native note and clears it from the Journal", async () => {
    spaceRequestMock
      .mockResolvedValueOnce({
        notes: [
          {
            id: "note_delete",
            space_id: "space-product",
            creator_user_id: "account-beta",
            title: "Delete me",
            plain_text: "",
            lifecycle_state: "active",
            collaboration_revision: 0,
            acl_version: 1,
            role: "creator",
            created_at: "2026-07-20T12:00:00.000Z",
            updated_at: "2026-07-20T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    const deleteTrigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete note"]',
    );
    expect(deleteTrigger).toBeTruthy();
    await act(async () => deleteTrigger?.click());
    await wait();
    await act(async () => buttonByText("Delete note").click());
    await wait();

    expect(spaceRequestMock).toHaveBeenLastCalledWith("/spaces/space-product/notes/note_delete", {
      method: "DELETE",
    });
    expect(useNotesStore.getState().notes).toEqual([]);
    expect(useNotesStore.getState().selectedNoteId).toBeUndefined();
  });

  it("refreshes the mounted Space notes when realtime announces a note change", async () => {
    spaceRequestMock
      .mockResolvedValueOnce({
        notes: [
          {
            id: "note_first",
            space_id: "space-product",
            creator_user_id: "account-beta",
            title: "First note",
            plain_text: "",
            lifecycle_state: "active",
            collaboration_revision: 0,
            acl_version: 1,
            role: "creator",
            created_at: "2026-07-20T12:00:00.000Z",
            updated_at: "2026-07-20T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        notes: [
          {
            id: "note_second",
            space_id: "space-product",
            creator_user_id: "other-user",
            title: "Second note",
            plain_text: "",
            lifecycle_state: "active",
            collaboration_revision: 0,
            acl_version: 1,
            role: "editor",
            created_at: "2026-07-20T12:02:00.000Z",
            updated_at: "2026-07-20T12:02:00.000Z",
          },
          {
            id: "note_first",
            space_id: "space-product",
            creator_user_id: "account-beta",
            title: "First note",
            plain_text: "",
            lifecycle_state: "active",
            collaboration_revision: 0,
            acl_version: 1,
            role: "creator",
            created_at: "2026-07-20T12:00:00.000Z",
            updated_at: "2026-07-20T12:00:00.000Z",
          },
        ],
      });

    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    expect(document.body.textContent).toContain("First note");
    expect(document.body.textContent).not.toContain("Second note");

    window.dispatchEvent(
      new CustomEvent("misty:space-note-event", {
        detail: { space_id: "space-product", type: "note.created" },
      }),
    );

    await wait(160);

    expect(useNotesStore.getState().notes.map((note) => note.title)).toEqual([
      "Second note",
      "First note",
    ]);
    expect(spaceRequestMock).toHaveBeenCalledTimes(2);
  });
});
