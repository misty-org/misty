import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { imageDocParts, readImageEdit } from "@/features/files";
import type { LocalToolRejected } from "../host";
import { imageFileKind, imageTools } from "./images";
import { SPACES, call, serve } from "./testRoutes";

const hoisted = vi.hoisted(() => ({
  images: new Map<string, unknown>(),
  gateway: { openLibraryImage: vi.fn() },
  canCut: true,
  invoke: vi.fn(),
  run: { conversationId: "c1", account: "acct", agentId: "ag", spaceId: "s1" } as {
    conversationId: string;
    account: string;
    agentId: string;
    spaceId: string;
  } | null,
}));

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
vi.mock("../runContexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => "s1"),
  loadRunEntry: vi.fn(async () => hoisted.run),
}));
vi.mock("../../spaces-gateway/spacesGateway", async (original) => ({
  ...(await original<object>()),
  spacesGateway: { maybe: () => hoisted.gateway },
}));
vi.mock("@/features/files", async (original) => ({
  ...(await original<object>()),
  loadPhoto: vi.fn(async () => ({ image: {}, width: 400, height: 300 })),
  renderEdit: vi.fn(async () => ({ width: 400, height: 300 })),
  canvasToBlob: vi.fn(
    async (_canvas: unknown, mimeType: string) => new Blob(["img"], { type: mimeType }),
  ),
  canRemoveBackground: vi.fn(async () => hoisted.canCut),
  removeBackground: vi.fn(async () => new Blob(["cut"], { type: "image/png" })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: hoisted.invoke }));

const refusal = (error: unknown) => error as LocalToolRejected;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

/** A Library image's live room, as the gateway hands it to the tools. */
function liveImage(id: string, options: { role?: string; mimeType?: string } = {}) {
  const doc = new Y.Doc();
  const image = {
    name: `${id}.jpg`,
    version: 3,
    mimeType: options.mimeType ?? "image/jpeg",
    width: 400,
    height: 300,
    doc,
    awareness: { clientID: 1, getStates: () => new Map(), setLocalState: vi.fn() },
    role: options.role ?? "editor",
    synced: Promise.resolve(),
    original: vi.fn(async () => new Blob(["original"])),
    replace: vi.fn(async () => 4),
    saveCopy: vi.fn(async () => ({ id: `${id}-copy` })),
    close: vi.fn(),
  };
  hoisted.images.set(id, image);
  return image;
}

beforeEach(() => {
  vi.clearAllMocks();
  serve({ ...SPACES });
  hoisted.images.clear();
  hoisted.canCut = true;
  hoisted.run = { conversationId: "c1", account: "acct", agentId: "ag", spaceId: "s1" };
  hoisted.gateway.openLibraryImage.mockImplementation(async (_space: string, id: string) => {
    const image = hoisted.images.get(id);
    if (!image) throw new Error("gone");
    return image;
  });
});

describe("agents editing images", () => {
  it("applies one change to each of a selection, reporting each image on its own", async () => {
    const a = liveImage("a");
    const b = liveImage("b", { role: "viewer" });
    const c = liveImage("c");
    const answer = (await call(imageTools["image.edit"], {
      space: "s1",
      item_ids: ["a", "b", "c", "a"],
      adjust: { brightness: 20 },
      aspect: "square",
    })) as {
      edited: number;
      failed: number;
      results: Array<{ item_id: string; error?: { code: string } }>;
    };
    expect(answer.results.map((result) => result.item_id)).toEqual(["a", "b", "c"]);
    expect(answer).toMatchObject({ edited: 2, failed: 1 });
    expect(answer.results[1].error?.code).toBe("not_allowed");
    for (const image of [a, c]) {
      const edit = readImageEdit(imageDocParts(image.doc));
      expect(edit.adjust.brightness).toBe(20);
      expect(edit.crop.width).toBeCloseTo(0.75);
    }
    expect(readImageEdit(imageDocParts(b.doc)).adjust.brightness).toBe(0);
  });

  it("refuses a change that can't apply before touching any image", async () => {
    liveImage("a");
    await expect(
      call(imageTools["image.edit"], { space: "s1", item_ids: ["a"], adjust: { glow: 5 } }),
    ).rejects.toSatisfy((error) => refusal(error).message.includes("adjust.glow"));
    expect(hoisted.gateway.openLibraryImage).not.toHaveBeenCalled();
    await expect(
      call(imageTools["image.edit"], { space: "s1", item_id: "a", item_ids: ["a"] }),
    ).rejects.toSatisfy((error) => refusal(error).message.includes("not both"));
  });
});

describe("saving an image", () => {
  it("saves the edit in the format asked for", async () => {
    const image = liveImage("a");
    await expect(
      call(imageTools["image.save"], {
        space: "s1",
        item_id: "a",
        mode: "copy",
        format: "webp",
        quality: 80,
      }),
    ).resolves.toEqual({ saved: "copy", name: "a edited.webp", item_id: "a-copy" });
    const { canvasToBlob } = await import("@/features/files");
    expect(canvasToBlob).toHaveBeenCalledWith(expect.anything(), "image/webp", 0.8);
    expect(image.saveCopy).toHaveBeenCalledWith(expect.any(Blob), "a edited.webp");
  });

  it("saves a file from the chat's folder as a new version, and the live edit starts over", async () => {
    const image = liveImage("a");
    imageDocParts(image.doc).adjust.set("exposure", 30);
    hoisted.invoke.mockResolvedValue(png.buffer);
    await expect(
      call(imageTools["image.save"], {
        space: "s1",
        item_id: "a",
        mode: "replace",
        path: "out/upscaled.bin",
      }),
    ).resolves.toEqual({ saved: "replaced", name: "a.jpg", version: 4 });
    expect(hoisted.invoke).toHaveBeenCalledWith("chat_media_load", {
      account: "acct",
      conversation: "c1",
      path: "out/upscaled.bin",
    });
    const saved = image.replace.mock.calls[0] as unknown as [Blob];
    expect(saved[0].type).toBe("image/png");
    const parts = imageDocParts(image.doc);
    expect(parts.adjust.size).toBe(0);
    expect(parts.meta.get("base")).toBe("4");
  });

  it("refuses a file that isn't an image, and a run with no chat folder", async () => {
    liveImage("a");
    hoisted.invoke.mockResolvedValue(new TextEncoder().encode("hello").buffer);
    await expect(
      call(imageTools["image.save"], { space: "s1", item_id: "a", mode: "copy", path: "a.png" }),
    ).rejects.toSatisfy((error) => refusal(error).message.includes("isn't a PNG"));
    hoisted.run = null;
    await expect(
      call(imageTools["image.save"], { space: "s1", item_id: "a", mode: "copy", path: "a.png" }),
    ).rejects.toSatisfy((error) => refusal(error).code === "not_allowed");
  });

  it("knows image files by their bytes", () => {
    expect(imageFileKind(png)?.mimeType).toBe("image/png");
    expect(imageFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe("image/jpeg");
    expect(imageFileKind(new TextEncoder().encode("GIF89a..."))?.mimeType).toBe("image/gif");
    expect(imageFileKind(new TextEncoder().encode("RIFF....WEBPVP8 "))?.mimeType).toBe(
      "image/webp",
    );
    expect(imageFileKind(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
  });
});

describe("removing a background", () => {
  it("saves the subject alone as a copy, as the Remove background tab does", async () => {
    const image = liveImage("a");
    await expect(
      call(imageTools["image.cutout"], { space: "s1", item_id: "a", mode: "copy" }),
    ).resolves.toEqual({ saved: "copy", name: "a (no background).png", item_id: "a-copy" });
    expect(image.saveCopy).toHaveBeenCalledWith(expect.any(Blob), "a (no background).png");
  });

  it("says so when this computer can't", async () => {
    liveImage("a");
    hoisted.canCut = false;
    await expect(
      call(imageTools["image.cutout"], { space: "s1", item_id: "a", mode: "replace" }),
    ).rejects.toSatisfy((error) => refusal(error).code === "unavailable");
    expect(hoisted.gateway.openLibraryImage).not.toHaveBeenCalled();
  });
});
