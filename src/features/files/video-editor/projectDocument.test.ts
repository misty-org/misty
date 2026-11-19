import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  media: [] as Array<{ projectId: string; mediaAsset: { id: string; file: File; name: string } }>,
  assets: [] as Array<Record<string, unknown>>,
  dirty: false,
  flushed: 0,
  loaded: [] as string[],
  shown: [] as string[],
  paused: 0,
  started: [] as string[],
}));

vi.mock("@opencut/services/storage/service", () => ({
  storageService: {
    writeSerializedProject: vi.fn(
      async ({ project }: { project: { metadata: { id: string } } }) => {
        state.stored.set(project.metadata.id, project);
      },
    ),
    readSerializedProject: vi.fn(async ({ id }: { id: string }) => state.stored.get(id) ?? null),
    saveMediaAsset: vi.fn(async (entry: (typeof state.media)[number]) => {
      state.media.push(entry);
    }),
    loadProject: vi.fn(async ({ id }: { id: string }) => {
      const stored = state.stored.get(id) as { metadata: { id: string } } | undefined;
      return stored ? { project: { ...stored, scenes: [{ id: "s" }], currentSceneId: "s" } } : null;
    }),
  },
}));
vi.mock("@opencut/core", () => ({
  EditorCore: {
    getInstance: () => ({
      save: {
        pause: () => void (state.paused += 1),
        resume: () => void (state.paused -= 1),
        getIsDirty: () => state.dirty,
        flush: async () => {
          state.flushed += 1;
          state.dirty = false;
        },
      },
      media: {
        getAssets: () => state.assets,
        loadProjectMedia: async ({ projectId }: { projectId: string }) =>
          void state.loaded.push(`media:${projectId}`),
      },
      project: {
        setActiveProject: ({ project }: { project: { metadata: { id: string } } }) =>
          void state.shown.push(project.metadata.id),
      },
      scenes: {
        initializeScenes: ({ currentSceneId }: { currentSceneId: string }) =>
          void state.shown.push(`scene:${currentSceneId}`),
      },
    }),
  },
}));
vi.mock("./videoProject", () => ({
  startVideoProject: vi.fn(async (name: string) => {
    state.started.push(name);
    return "fresh";
  }),
}));

import { captureVideoProject, openVideoProject, showRemoteProject } from "./projectDocument";
import { emptyVideoProject, type VideoProjectDocument } from "./projectDocumentTypes";

const project = { metadata: { id: "p1", updatedAt: "2026-11-18T10:00:00Z" }, scenes: [] };
const kept: VideoProjectDocument = {
  kind: "misty.video",
  version: 1,
  project,
  media: [{ assetId: "a1", itemId: "i1", name: "clip.mp4", type: "video", duration: 4 }],
};
const loadMedia = vi.fn(async (itemId: string) => new File(["x"], `${itemId}.mp4`));

beforeEach(() => {
  state.stored.clear();
  state.media = [];
  state.assets = [];
  state.dirty = false;
  state.flushed = 0;
  state.loaded = [];
  state.shown = [];
  state.paused = 0;
  state.started = [];
  loadMedia.mockClear();
});

describe("a project between its Space and the editor", () => {
  it("opens a kept project under its own id, its media read from the Space", async () => {
    expect(await openVideoProject("Trip", kept, loadMedia)).toBe("p1");
    expect(state.stored.get("p1")).toBe(project);
    expect(loadMedia).toHaveBeenCalledWith("i1");
    expect(state.media[0]).toMatchObject({
      projectId: "p1",
      mediaAsset: { id: "a1", name: "clip.mp4", type: "video", duration: 4 },
    });
  });

  it("makes a new project for one with nothing in it yet", async () => {
    expect(await openVideoProject("Trip", emptyVideoProject(), loadMedia)).toBe("fresh");
    expect(state.started).toEqual(["Trip"]);
  });

  it("captures the project with its media's items, and names media not in the Space yet", async () => {
    state.stored.set("p1", project);
    state.dirty = true;
    const local = new File(["y"], "local.mov");
    state.assets = [
      { id: "a1", name: "clip.mp4", type: "video", duration: 4, file: new File(["x"], "clip.mp4") },
      { id: "a2", name: "local.mov", type: "video", file: local },
      { id: "a3", name: "temp", type: "image", ephemeral: true, file: new File([""], "t") },
    ];
    const { document, unkept } = await captureVideoProject("p1", new Map([["a1", "i1"]]));
    expect(state.flushed).toBe(1);
    expect(document.project).toBe(project);
    expect(document.media).toEqual([
      { assetId: "a1", itemId: "i1", name: "clip.mp4", type: "video", duration: 4 },
    ]);
    expect(unkept).toEqual([{ assetId: "a2", file: local }]);
  });

  it("doesn't save again when nothing is unsaved (a save would call the keeper back)", async () => {
    state.stored.set("p1", project);
    await captureVideoProject("p1", new Map());
    expect(state.flushed).toBe(0);
  });

  it("shows someone else's change, reading only the media this window lacks", async () => {
    state.assets = [{ id: "a1" }];
    const changed: VideoProjectDocument = {
      ...kept,
      media: [...kept.media, { assetId: "a9", itemId: "i9", name: "new.mp4", type: "video" }],
    };
    await showRemoteProject(changed, loadMedia);
    expect(loadMedia).toHaveBeenCalledTimes(1);
    expect(loadMedia).toHaveBeenCalledWith("i9");
    expect(state.stored.get("p1")).toBe(project);
    // Swapped in place, its new media first, with saving paused and resumed around it.
    expect(state.loaded).toEqual(["media:p1"]);
    expect(state.shown).toEqual(["p1", "scene:s"]);
    expect(state.paused).toBe(0);
  });
});
