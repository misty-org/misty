import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { SpaceDeck } from "../api";
import { createDeck, readDeckOutline, slideIdsInOrder } from "../deck/model";
import type { DeckSession } from "../session";
import { DeckEditor } from "./DeckEditor";

vi.mock("@/features/agents", () => ({
  useAiSurfaceAdapter: vi.fn(),
  useAiSurfaceActions: () => ({ available: false, runAction: vi.fn() }),
  AiSelectionMenu: () => null,
}));
vi.mock("@/features/files", () => ({
  MistyFilePicker: () => null,
  readFileFromPath: vi.fn(),
}));
vi.mock("../../library", () => ({ MistyLibraryPicker: () => null }));
vi.mock("@/features/spaces/embeds", () => ({
  EmbedPicker: ({ children }: { children: ReactNode }) => children,
  LiveEmbed: () => null,
}));
vi.mock("@/features/spaces/history", () => ({ HistoryDialog: () => null }));
// jsdom lays nothing out: give the stage room so the slide is drawn.
vi.mock("../render/renderHooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useElementSize: () => ({ width: 1280, height: 800 }),
}));
vi.mock("./TextSlotEditor", () => ({
  TextSlotEditor: ({ spec }: { spec: { name: string } }) => (
    <div data-testid={`slot-${spec.name}`} />
  ),
}));

const deck: SpaceDeck = {
  id: "deck-1",
  space_id: "space-1",
  creator_user_id: "user-1",
  title: "Launch review",
  lifecycle_state: "active",
  collaboration_revision: 1,
  acl_version: 1,
  created_at: "2026-11-18T10:00:00.000Z",
  updated_at: "2026-11-18T10:00:00.000Z",
  role: "creator",
  can_delete: true,
  visibility: "public",
};

function setup(role: SpaceDeck["role"] = "creator") {
  const doc = new Y.Doc();
  createDeck(doc, {
    title: "Launch review",
    slides: [
      { layout: "title", title: "Launch review" },
      { layout: "bullets", title: "Shipped", body: "- Docs" },
      { layout: "quote", quote: "Ship it" },
    ],
  });
  const awareness = new Awareness(doc);
  const session = {
    key: "space-1:deck-1",
    spaceId: "space-1",
    deckId: "deck-1",
    role,
    doc,
    provider: { awareness, synced: true, on: vi.fn(), off: vi.fn() },
    access: { lost: null, subscribe: () => () => undefined, lose: vi.fn(), retry: vi.fn() },
  } as unknown as DeckSession;
  render(
    <DeckEditor
      deck={{ ...deck, role }}
      session={session}
      user={{ id: "user-1", name: "Alex" }}
      role={role}
      readOnly={false}
      onBack={vi.fn()}
      onRename={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  return { doc };
}

const thumbs = () => screen.getAllByRole("button", { name: /^Slide \d/ });
const rail = () => screen.getByLabelText("Slides");

describe("DeckEditor", () => {
  afterEach(() => cleanup());

  it("shows a numbered thumbnail for each slide, the first one open", () => {
    setup();
    expect(thumbs()).toHaveLength(3);
    expect(thumbs()[0].getAttribute("aria-current")).toBe("true");
  });

  it("adds a slide at the end from + Slide and opens it", () => {
    const { doc } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Slide" }));
    const ids = slideIdsInOrder(doc);
    expect(ids).toHaveLength(4);
    expect(readDeckOutline(doc).slides[3].layout).toBe("bullets");
    expect(thumbs()[3].getAttribute("aria-current")).toBe("true");
  });

  it("moves between slides with the arrow keys", () => {
    setup();
    fireEvent.keyDown(thumbs()[0], { key: "ArrowDown" });
    expect(thumbs()[1].getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(thumbs()[1], { key: "ArrowUp" });
    expect(thumbs()[0].getAttribute("aria-current")).toBe("true");
  });

  it("duplicates the open slide with ⌘D", () => {
    const { doc } = setup();
    fireEvent.click(thumbs()[1]);
    fireEvent.keyDown(thumbs()[1], { key: "d", metaKey: true });
    const outline = readDeckOutline(doc);
    expect(outline.slides).toHaveLength(4);
    expect(outline.slides[2].slots).toEqual(outline.slides[1].slots);
  });

  it("deletes a slide with ⌫ on its thumbnail, and ⌘Z brings it back", () => {
    const { doc } = setup();
    const before = slideIdsInOrder(doc);
    fireEvent.keyDown(thumbs()[2], { key: "Backspace" });
    expect(slideIdsInOrder(doc)).toEqual(before.slice(0, 2));
    fireEvent.keyDown(thumbs()[0], { key: "z", metaKey: true });
    expect(slideIdsInOrder(doc)).toEqual(before);
  });

  it("edits the open slide's text slots in place", () => {
    setup();
    fireEvent.click(thumbs()[1]);
    expect(screen.getByTestId("slot-title")).toBeTruthy();
    expect(screen.getByTestId("slot-body")).toBeTruthy();
  });

  it("offers no editing to a viewer", () => {
    setup("viewer");
    expect(screen.queryByRole("button", { name: "Slide" })).toBeNull();
    expect(screen.queryByTestId("slot-title")).toBeNull();
    expect(within(rail()).getAllByRole("button", { name: /^Slide \d/ })).toHaveLength(3);
  });
});
