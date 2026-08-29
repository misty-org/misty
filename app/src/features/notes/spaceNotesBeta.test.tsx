import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-beta" } }),
}));

vi.mock("@/api/spaces/api", () => ({
  spaceRequest: spaceRequestMock,
}));

vi.mock("./components/NoteBlockEditor", () => ({
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

import { SpaceNotes } from "./SpaceNotes";
import { useNotesStore } from "./store";
import { resetNotesAccountState } from "./store/useNotesStore";

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
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
    spaceRequestMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/status")) return { connected: false };
      if (path.endsWith("/integrations")) return { integrations: [], providers: [] };
      if (path.endsWith("/provider-resources")) return { resources: [] };
      return { notes: [] };
    });
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
    <MemoryRouter key={entry} initialEntries={[entry]}>
      <SpaceNotes spaceId="space-product" spaceName="Product" />
      <LocationProbe />
    </MemoryRouter>
  );

  it("keeps connector management out of Journal", async () => {
    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    expect(document.body.textContent).not.toContain("Sources");
    expect(document.body.textContent).not.toContain("Manage sources");
    expect(document.body.textContent).not.toContain("Journal integrations");
    expect(document.body.textContent).not.toContain("Publish to Notion");
    expect(document.body.textContent).not.toContain("Open in Notion");
    expect(document.body.textContent).not.toContain("Unlinked");
    expect(document.body.textContent).not.toContain(
      "Misty notes are saved privately on this desktop and belong to this Space.",
    );
    expect(
      document.body.querySelector('button[aria-label="Manage Journal integrations"]'),
    ).toBeNull();
  });

  it("opens the existing note dialog from a note creation query", async () => {
    await act(async () => {
      root.render(notesSurface("/spaces/space-product/notes?create=note"));
    });
    await wait();

    expect(document.body.textContent).toContain("New note");
    expect(document.body.querySelector("#new-note-title")).not.toBeNull();
  });

  it("creates a title-only collaborative Space note and selects it", async () => {
    const createdResponse = {
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
    };
    spaceRequestMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/status")) return { connected: false };
      if (path === "/spaces/space-product/notes" && init?.method === "POST") return createdResponse;
      return { notes: [] };
    });
    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    await act(async () => {
      buttonByText("New").click();
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
    });
    await act(async () => {
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
      const createButton = Array.from(
        dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((candidate) => candidate.textContent?.trim() === "Create note");
      createButton?.click();
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
    expect(document.body.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe(
      "Beta note",
    );
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
    let deleted = false;
    const noteToDelete = {
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
    };
    spaceRequestMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/status")) return { connected: false };
      if (path.endsWith("/notes/note_delete") && init?.method === "DELETE") {
        deleted = true;
        return undefined;
      }
      if (path.endsWith("/notes")) return { notes: deleted ? [] : [noteToDelete] };
      return undefined;
    });

    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    const noteRow = Array.from(document.body.querySelectorAll("h3"))
      .find((candidate) => candidate.textContent?.trim() === "Delete me")
      ?.closest<HTMLButtonElement>("button");
    expect(noteRow).toBeTruthy();
    await act(async () => {
      noteRow?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
      );
    });
    await wait();
    const deleteAction = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (candidate) => candidate.textContent?.trim() === "Delete",
    );
    expect(deleteAction).toBeTruthy();
    await act(async () => (deleteAction as HTMLElement | undefined)?.click());
    await wait();

    expect(spaceRequestMock).not.toHaveBeenCalledWith("/spaces/space-product/notes/note_delete", {
      method: "DELETE",
    });
    const confirmation = document.body.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(confirmation?.textContent).toContain(
      "“Delete me” will be permanently deleted. This cannot be undone.",
    );
    const confirmDelete = Array.from(
      confirmation?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((candidate) => candidate.textContent?.trim() === "Delete");
    expect(confirmDelete).toBeTruthy();
    await act(async () => confirmDelete?.click());
    await wait();

    expect(spaceRequestMock).toHaveBeenLastCalledWith("/spaces/space-product/notes/note_delete", {
      method: "DELETE",
    });
    expect(useNotesStore.getState().notes).toEqual([]);
    expect(useNotesStore.getState().selectedNoteId).toBeUndefined();
  });

  it("refreshes the mounted Space notes when realtime announces a note change", async () => {
    const first = {
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
    };
    const second = {
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
    };
    let noteListReads = 0;
    let changed = false;
    spaceRequestMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/status")) return { connected: false };
      if (path.endsWith("/notes")) {
        noteListReads += 1;
        return { notes: changed ? [second, first] : [first] };
      }
      return undefined;
    });

    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    expect(document.body.textContent).toContain("First note");
    expect(document.body.textContent).not.toContain("Second note");

    changed = true;
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
    expect(noteListReads).toBeGreaterThanOrEqual(2);
  });

  it("renders the searchable note list by default and allows navigation to doc and back to list", async () => {
    const note1 = {
      id: "note-1",
      space_id: "space-product",
      creator_user_id: "account-beta",
      title: "Alpha Roadmap Note",
      plain_text: "",
      lifecycle_state: "active",
      collaboration_revision: 0,
      acl_version: 1,
      role: "creator",
      created_at: "2026-07-20T12:00:00.000Z",
      updated_at: "2026-07-20T12:00:00.000Z",
    };
    const note2 = {
      id: "note-2",
      space_id: "space-product",
      creator_user_id: "account-beta",
      title: "Beta Sprint Plan",
      plain_text: "",
      lifecycle_state: "active",
      collaboration_revision: 0,
      acl_version: 1,
      role: "creator",
      created_at: "2026-07-20T12:00:00.000Z",
      updated_at: "2026-07-20T12:00:00.000Z",
    };
    spaceRequestMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/status")) return { connected: false };
      if (path.endsWith("/notes")) return { notes: [note1, note2] };
      return undefined;
    });

    await act(async () => {
      root.render(notesSurface());
    });
    await wait(180);

    // Initial view is the note list
    expect(container.querySelector("h1")?.textContent).toBe("My Notes");
    expect(container.querySelector("h1")?.closest(".rounded-2xl")).toBeNull();
    expect(container.textContent).toContain("Alpha Roadmap Note");
    expect(container.textContent).toContain("Beta Sprint Plan");

    // Search notes in List view
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search notes"]',
    );
    expect(searchInput).not.toBeNull();

    await act(async () => {
      useNotesStore.getState().setQuery("Beta");
    });

    expect(container.querySelector('section[aria-label="Recently edited"]')).toBeNull();
    const resultsPanel = searchInput?.closest(".rounded-2xl");
    expect(resultsPanel?.textContent).toContain("Beta Sprint Plan");
    expect(resultsPanel?.textContent).not.toContain("Alpha Roadmap Note");

    await act(async () => {
      useNotesStore.getState().setQuery("");
    });

    // Select the note, then use the explicit Open action to enter document view.
    const betaNoteCard = Array.from(container.querySelectorAll("h3")).find(
      (el) => el.textContent === "Beta Sprint Plan",
    );
    expect(betaNoteCard).toBeTruthy();
    await act(async () => {
      betaNoteCard?.click();
    });
    expect(
      betaNoteCard
        ?.closest("button")
        ?.parentElement?.querySelector<HTMLButtonElement>(
          'button[aria-label="More actions for Beta Sprint Plan"]',
        ),
    ).toBeTruthy();
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Beta Sprint Plan"]',
    );
    expect(openButton).toBeTruthy();
    expect(openButton?.dataset.variant).toBe("default");
    expect(openButton?.querySelector('[data-icon="inline-end"]')).not.toBeNull();
    await act(async () => {
      openButton?.click();
    });
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/spaces/space-product/notes?view=doc&note=note-2",
    );

    // Now in document view with Back button
    const backButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to notes"]',
    );
    expect(backButton).not.toBeNull();
    expect(backButton?.textContent).toContain("Notes");

    // Click Back to return to List view
    await act(async () => {
      backButton?.click();
    });

    expect(container.textContent).toContain("Alpha Roadmap Note");
    expect(container.textContent).toContain("Beta Sprint Plan");
    expect(container.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      "/spaces/space-product/notes?view=list&note=note-2",
    );

    // A tab remount must follow the remembered list route instead of reopening the document.
    await act(async () => {
      root.render(notesSurface("/spaces/space-product/notes?view=list&note=note-2"));
    });
    await wait();
    expect(container.querySelector('button[aria-label="Back to notes"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Search notes"]')).not.toBeNull();
  });
});
