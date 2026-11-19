import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const spaceRequest = vi.hoisted(() => vi.fn());
vi.mock("../api/api", () => ({ spaceRequest }));

import { HistoryDialog } from "./HistoryDialog";
import { summarizeDeckVersion, summarizeWorkbookVersion, versionDoc } from "./historySummary";

function encode(doc: Y.Doc): string {
  const bytes = Y.encodeStateAsUpdate(doc);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function noteVersion(title: string, text: string): string {
  const doc = new Y.Doc();
  doc.getText("misty:title").insert(0, title);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("tiptap").insert(0, [paragraph]);
  return encode(doc);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

describe("HistoryDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    spaceRequest.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  it("lists versions newest first, previews the picked one, and restores it", async () => {
    let finishRestore: () => void = () => undefined;
    spaceRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/spaces/s1/notes/n1/history")
        return Promise.resolve({
          versions: [
            { id: "v1", created_at: "2026-11-17T09:00:00.000Z", content_bytes: 2048 },
            { id: "v2", created_at: "2026-11-18T09:00:00.000Z", content_bytes: 4096 },
          ],
        });
      if (path === "/spaces/s1/notes/n1/history/v2")
        return Promise.resolve({ update: noteVersion("Plan", "Newest words") });
      if (path === "/spaces/s1/notes/n1/history/v1")
        return Promise.resolve({ update: noteVersion("Plan", "Older words") });
      if (path === "/spaces/s1/notes/n1/history/v1/restore" && init?.method === "POST")
        return new Promise<void>((resolve) => {
          finishRestore = resolve;
        });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const onOpenChange = vi.fn();
    const onRestored = vi.fn();
    await act(async () => {
      root.render(
        <HistoryDialog
          spaceId="s1"
          kind="notes"
          itemId="n1"
          open
          onOpenChange={onOpenChange}
          onRestored={onRestored}
        />,
      );
    });
    await flush();
    await flush();

    expect(document.body.textContent).toContain("Version history");
    expect(document.body.textContent).toContain("Newest words");

    const rows = Array.from(document.body.querySelectorAll("[data-slot='list-row']"));
    const older = rows
      .find((row) => row.textContent?.includes("2 KB"))
      ?.querySelector<HTMLElement>("[data-slot='list-row-open']");
    expect(older).toBeTruthy();
    await act(async () => older?.click());
    await flush();
    expect(document.body.textContent).toContain("Older words");

    await act(async () => button("Restore")?.click());
    // Busy: the button is disabled, with no spinner in it.
    expect(button("Restore")?.disabled).toBe(true);
    expect(button("Restore")?.querySelector("[role='status']")).toBeNull();
    await act(async () => finishRestore());
    await flush();
    expect(spaceRequest).toHaveBeenCalledWith("/spaces/s1/notes/n1/history/v1/restore", {
      method: "POST",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
  });

  it("says so when there are no versions yet, with Restore disabled", async () => {
    spaceRequest.mockResolvedValue({ versions: [] });
    await act(async () => {
      root.render(
        <HistoryDialog spaceId="s1" kind="drawings" itemId="d1" open onOpenChange={vi.fn()} />,
      );
    });
    await flush();
    expect(document.body.textContent).toContain("No versions yet");
    expect(button("Restore")?.disabled).toBe(true);
  });

  it("offers Try again when the versions can't load", async () => {
    spaceRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ versions: [] });
    await act(async () => {
      root.render(
        <HistoryDialog spaceId="s1" kind="decks" itemId="k1" open onOpenChange={vi.fn()} />,
      );
    });
    await flush();
    expect(document.body.textContent).toContain("Versions couldn’t load");
    await act(async () => button("Try again")?.click());
    await flush();
    expect(document.body.textContent).toContain("No versions yet");
  });
});

describe("version summaries", () => {
  it("reads a deck's slide titles and a workbook's sheets from their layouts", () => {
    const deck = new Y.Doc();
    deck.getMap("deck:meta").set("title", "Pitch");
    deck.getArray<string>("deck:order").insert(0, ["s1", "s2"]);
    const slides = deck.getMap<Y.Map<unknown>>("deck:slides");
    for (const [id, title] of [
      ["s1", "Hello"],
      ["s2", ""],
    ] as const) {
      const slide = new Y.Map<unknown>();
      const slots = new Y.Map<unknown>();
      const fragment = new Y.XmlFragment();
      slots.set("title", fragment);
      slide.set("slots", slots);
      slides.set(id, slide);
      if (title) {
        const paragraph = new Y.XmlElement("paragraph");
        paragraph.insert(0, [new Y.XmlText(title)]);
        fragment.insert(0, [paragraph]);
      }
    }
    expect(summarizeDeckVersion(versionDoc(Y.encodeStateAsUpdate(deck)))).toEqual({
      title: "Pitch",
      slides: ["Hello", ""],
    });

    const workbook = new Y.Doc();
    workbook.getArray<string>("wb:sheetOrder").insert(0, ["b", "a"]);
    const sheets = workbook.getMap<Y.Map<unknown>>("wb:sheets");
    for (const [id, name] of [
      ["a", "Raw"],
      ["b", "Summary"],
    ]) {
      const sheet = new Y.Map<unknown>();
      sheet.set("name", name);
      sheets.set(id!, sheet);
    }
    workbook.getMap("wb:charts").set("c1", { type: "bar", title: "Totals" });
    expect(summarizeWorkbookVersion(versionDoc(Y.encodeStateAsUpdate(workbook)))).toMatchObject({
      sheets: ["Summary", "Raw"],
      charts: 1,
    });
  });
});
