import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { SPACES, call, serve } from "./testRoutes";
import { videoDuplicateTool } from "./videoDuplicate";

const hoisted = vi.hoisted(() => ({
  video: {
    name: "Trip",
    role: "editor" as "editor" | "viewer",
    read: vi.fn(),
    keep: vi.fn(),
    loadMedia: vi.fn(),
    close: vi.fn(),
  },
  gateway: {
    openLibraryVideo: vi.fn(),
    uploadLibraryBlob: vi.fn(async (..._args: unknown[]) => ({ item: { id: "copy-1" } })),
  },
}));

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
vi.mock("../runContexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => "s1"),
}));
vi.mock("../../spaces-gateway/spacesGateway", async (original) => ({
  ...(await original<object>()),
  spacesGateway: { maybe: () => hoisted.gateway },
}));

const project = {
  metadata: { id: "p-1", name: "Trip", createdAt: "x", updatedAt: "x", duration: 8 },
  scenes: [{ id: "scene", tracks: { main: { elements: [{ id: "e1", mediaId: "a1" }] } } }],
};
const kept = {
  kind: "misty.video",
  version: 1,
  project,
  media: [{ assetId: "a1", itemId: "m1", name: "clip.mp4", type: "video" }],
};

/** The project the copy was uploaded as. */
async function uploaded() {
  const [, blob, filename] = hoisted.gateway.uploadLibraryBlob.mock.calls[0] as [
    string,
    Blob,
    string,
  ];
  return { filename, document: JSON.parse(await blob.text()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  serve({ ...SPACES });
  hoisted.video.read.mockResolvedValue(kept);
  hoisted.gateway.openLibraryVideo.mockResolvedValue(hoisted.video);
});

describe("agents duplicating a video project", () => {
  it("copies it into a new Media item of its own, pointing at the same media", async () => {
    await expect(call(videoDuplicateTool, { space: "s1", item_id: "p1" })).resolves.toEqual({
      item_id: "copy-1",
      name: "Trip copy",
    });
    expect(hoisted.gateway.openLibraryVideo).toHaveBeenCalledWith("s1", "p1");
    expect(hoisted.video.close).toHaveBeenCalled();
    const { filename, document } = await uploaded();
    expect(filename).toBe("Trip copy.mistyvideo");
    expect(document.media).toEqual(kept.media);
    expect(document.project.scenes).toEqual(project.scenes);
    expect(document.project.metadata.id).not.toBe("p-1");
    expect(document.project.metadata.name).toBe("Trip copy");
    // The original is left as it was.
    expect(project.metadata.id).toBe("p-1");
  });

  it("names the copy as asked", async () => {
    await call(videoDuplicateTool, { space: "s1", item_id: "p1", name: "Hook two" });
    expect((await uploaded()).filename).toBe("Hook two.mistyvideo");
  });

  it("refuses an item that isn't a video project", async () => {
    hoisted.gateway.openLibraryVideo.mockRejectedValueOnce(
      new Error("This Media item isn't a video project."),
    );
    await expect(call(videoDuplicateTool, { space: "s1", item_id: "photo" })).rejects.toSatisfy(
      (error) => (error as LocalToolRejected).message === "This Media item isn't a video project.",
    );
    expect(hoisted.gateway.uploadLibraryBlob).not.toHaveBeenCalled();
  });
});
