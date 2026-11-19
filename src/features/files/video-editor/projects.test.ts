import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const captured = vi.hoisted(() => ({
  results: [] as Array<{ document: unknown; unkept: Array<{ assetId: string; file: File }> }>,
}));
vi.mock("./projectDocument", () => ({
  captureVideoProject: vi.fn(async () => captured.results.shift()),
}));

import {
  emptyVideoProject,
  isVideoProjectFile,
  parseVideoProject,
  VIDEO_PROJECT_MIME,
  type VideoProjectDocument,
} from "./projectDocumentTypes";
import { createProjectKeeper } from "./projectKeeper";
import {
  newerProject,
  projectUpdatedAt,
  readRoomProject,
  watchRoomProject,
  writeRoomProject,
} from "./projectRoom";

const at = (iso: string, media: VideoProjectDocument["media"] = []): VideoProjectDocument => ({
  kind: "misty.video",
  version: 1,
  project: { metadata: { id: "p1", updatedAt: iso } },
  media,
});

afterEach(() => {
  vi.useRealTimers();
  captured.results = [];
});

describe("a video project file", () => {
  it("reads back what was written, empty or not", () => {
    expect(parseVideoProject(JSON.stringify(emptyVideoProject()))).toEqual(emptyVideoProject());
    const document = at("2026-11-18T10:00:00Z", [
      { assetId: "a1", itemId: "i1", name: "clip.mp4", type: "video", duration: 4 },
    ]);
    expect(parseVideoProject(JSON.stringify(document))).toEqual(document);
  });

  it.each([
    ["not JSON", "{"],
    ["another kind", JSON.stringify({ kind: "misty.doc", version: 1, project: null, media: [] })],
    ["a newer version", JSON.stringify({ ...emptyVideoProject(), version: 2 })],
    [
      "media without its item",
      JSON.stringify({ ...emptyVideoProject(), media: [{ assetId: "a" }] }),
    ],
    [
      "a project without an id",
      JSON.stringify({ ...emptyVideoProject(), project: { metadata: {} } }),
    ],
  ])("refuses %s", (_, text) => {
    expect(() => parseVideoProject(text)).toThrow();
  });

  it("is told apart by its type or its name", () => {
    expect(isVideoProjectFile(VIDEO_PROJECT_MIME, "x")).toBe(true);
    expect(isVideoProjectFile("", "Trip.mistyvideo")).toBe(true);
    expect(isVideoProjectFile("application/json", "data.json")).toBe(false);
  });
});

describe("a video project's live room", () => {
  it("shares a document, and passes over this window's own writes", () => {
    const room = new Y.Doc();
    const seen = vi.fn();
    const stop = watchRoomProject(room, seen);
    writeRoomProject(room, at("2026-11-18T10:00:00Z"));
    expect(seen).not.toHaveBeenCalled();
    expect(readRoomProject(room)).toEqual(at("2026-11-18T10:00:00Z"));

    // Another window (or an agent) writing, after syncing with the room as a real one does.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(room));
    other.getMap<string>("video").set("document", JSON.stringify(at("2026-11-18T10:05:00Z")));
    Y.applyUpdate(room, Y.encodeStateAsUpdate(other));
    expect(seen).toHaveBeenCalledWith(at("2026-11-18T10:05:00Z"));
    stop();
  });

  it("opens from whichever is newer, the kept file or the room", () => {
    const kept = at("2026-11-18T10:00:00Z");
    const room = at("2026-11-18T11:00:00Z");
    expect(newerProject(kept, room)).toBe(room);
    expect(newerProject(room, kept)).toBe(room);
    expect(newerProject(kept, null)).toBe(kept);
    expect(projectUpdatedAt(emptyVideoProject())).toBe(0);
  });
});

describe("keeping an open project in its Space", () => {
  const source = () => ({
    load: vi.fn(),
    loadMedia: vi.fn(),
    keep: vi.fn(async () => undefined),
    keepMedia: vi.fn(async (file: File) => `item-${file.name}`),
  });

  it("keeps once changes rest, and closing an unchanged project writes nothing", async () => {
    vi.useFakeTimers();
    const kept = source();
    const keeper = createProjectKeeper("p1", kept, new Map(), vi.fn());
    await keeper.flush();
    expect(kept.keep).not.toHaveBeenCalled();
    captured.results.push({ document: at("2026-11-18T10:00:00Z"), unkept: [] });
    keeper.schedule();
    keeper.schedule();
    await vi.advanceTimersByTimeAsync(1600);
    expect(kept.keep).toHaveBeenCalledTimes(1);
    await keeper.flush();
    expect(kept.keep).toHaveBeenCalledTimes(1);
  });

  it("adds media from the computer to Media first, so the project only points at Media", async () => {
    const kept = source();
    const itemIds = new Map<string, string>();
    const keeper = createProjectKeeper("p1", kept, itemIds, vi.fn());
    const file = new File(["x"], "local.mp4");
    captured.results.push(
      { document: at("2026-11-18T10:00:00Z"), unkept: [{ assetId: "a2", file }] },
      { document: at("2026-11-18T10:00:00Z"), unkept: [] },
    );
    keeper.schedule();
    await keeper.flush();
    expect(kept.keepMedia).toHaveBeenCalledWith(file);
    expect(itemIds.get("a2")).toBe("item-local.mp4");
    expect(kept.keep).toHaveBeenCalledTimes(1);
  });

  it("says when a change could not be kept, and keeps the next one", async () => {
    const kept = source();
    kept.keep.mockRejectedValueOnce(new Error("offline"));
    const onError = vi.fn();
    const keeper = createProjectKeeper("p1", kept, new Map(), onError);
    captured.results.push(
      { document: at("2026-11-18T10:00:00Z"), unkept: [] },
      { document: at("2026-11-18T10:01:00Z"), unkept: [] },
    );
    keeper.schedule();
    await keeper.flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
    keeper.schedule();
    await keeper.flush();
    expect(kept.keep).toHaveBeenCalledTimes(2);
  });
});
