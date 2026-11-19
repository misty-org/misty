import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { SPACES, call, serve } from "./testRoutes";
import { forgetVideoTurn, videoTurnBefore } from "./videoTurns";

const hoisted = vi.hoisted(() => ({
  video: {
    name: "Trip",
    role: "editor" as "editor" | "viewer",
    read: vi.fn(),
    keep: vi.fn(async () => undefined),
    loadMedia: vi.fn(),
    close: vi.fn(),
  },
  gateway: {
    openLibraryVideo: vi.fn(),
    uploadLibraryBlob: vi.fn(async () => ({ item: { id: "out" } })),
    libraryFile: vi.fn(async () => new File(["abc"], "clip.mp4", { type: "video/mp4" })),
  },
  tools: {
    describeVideoProject: vi.fn(() => ({ duration: 8, tracks: [] })),
    editVideoProject: vi.fn(),
    renderFrames: vi.fn(async (_doc: unknown, at: number[]) =>
      at.map((time) => ({
        at: time,
        dataUrl: "data:image/png;base64,AA==",
        width: 64,
        height: 36,
      })),
    ),
    timelineAudio: vi.fn(async () => new Blob(["wav"])),
    exportVideoProject: vi.fn(async () => new Blob(["mp4"], { type: "video/mp4" })),
  },
  invoke: vi.fn(),
  run: { conversationId: "c1", account: "acct", agentId: "ag", spaceId: "s1" },
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
  // jsdom has no WebCodecs; the tools run as on a computer that has them.
  canEditVideo: () => true,
  loadVideoProjectTools: async () => hoisted.tools,
}));
vi.mock("@/features/voice", () => ({
  recognizeAudioWords: vi.fn(async () => [{ text: "hi", start: 0.1, end: 0.4 }]),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: hoisted.invoke }));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;
const before = { kind: "misty.video", version: 1, project: null, media: [] };
const after = { ...before, media: [{ assetId: "a", itemId: "i", name: "a", type: "video" }] };

beforeEach(() => {
  vi.clearAllMocks();
  serve({ ...SPACES });
  hoisted.video.role = "editor";
  hoisted.video.read.mockResolvedValue(before);
  hoisted.gateway.openLibraryVideo.mockResolvedValue(hoisted.video);
  hoisted.tools.editVideoProject.mockResolvedValue(after);
});

describe("agents working on a video project", () => {
  it("reads it, and lets the room go after", async () => {
    await expect(call(tool("video.read"), { space: "s1", item_id: "p1" })).resolves.toMatchObject({
      name: "Trip",
      duration: 8,
    });
    expect(hoisted.gateway.openLibraryVideo).toHaveBeenCalledWith("s1", "p1");
    expect(hoisted.video.close).toHaveBeenCalled();
  });

  it("keeps an edit at once, and remembers the project as it was for the turn's Revert", async () => {
    forgetVideoTurn("run-1");
    const edits = [{ op: "cut", ranges: [{ start: 1, end: 2 }] }];
    await call(tool("video.edit"), { space: "s1", item_id: "p1", edits });
    expect(hoisted.tools.editVideoProject).toHaveBeenCalledWith(
      before,
      edits,
      hoisted.video.loadMedia,
    );
    expect(hoisted.video.keep).toHaveBeenCalledWith(after);
    expect(videoTurnBefore("run-1")).toEqual([
      { itemId: "p1", spaceId: "s1", document: before, at: expect.any(Number) },
    ]);
    // A second change in the same turn keeps the first "before".
    hoisted.video.read.mockResolvedValue(after);
    await call(tool("video.edit"), { space: "s1", item_id: "p1", edits });
    expect(videoTurnBefore("run-1")[0].document).toEqual(before);
  });

  it("refuses edits a viewer can't make, and edits the editor can't apply", async () => {
    hoisted.video.role = "viewer";
    await expect(
      call(tool("video.edit"), {
        space: "s1",
        item_id: "p1",
        edits: [{ op: "frame", aspect: "1:1" }],
      }),
    ).rejects.toSatisfy((error) => refusal(error).includes("only be viewed"));
    hoisted.video.role = "editor";
    hoisted.tools.editVideoProject.mockRejectedValueOnce(
      new Error("There is no clip x in this video"),
    );
    await expect(
      call(tool("video.edit"), {
        space: "s1",
        item_id: "p1",
        edits: [{ op: "delete", element_ids: ["x"] }],
      }),
    ).rejects.toSatisfy((error) => refusal(error).includes("There is no clip x"));
    expect(hoisted.video.keep).not.toHaveBeenCalled();
  });

  it("shows frames as pictures", async () => {
    const answer = (await call(tool("video.frames"), {
      space: "s1",
      item_id: "p1",
      at: [0, 1.5],
    })) as {
      displayCaptures: Array<{ name: string; dataUrl: string }>;
    };
    expect(answer.displayCaptures.map((frame) => frame.name)).toEqual([
      "Trip at 0s",
      "Trip at 1.5s",
    ]);
  });

  it("hears the video word by word", async () => {
    await expect(call(tool("video.transcript"), { space: "s1", item_id: "p1" })).resolves.toEqual({
      words: [{ text: "hi", start: 0.1, end: 0.4 }],
    });
  });

  it("renders the finished video into Media", async () => {
    await expect(
      call(tool("video.export"), { space: "s1", item_id: "p1", name: "Final cut" }),
    ).resolves.toMatchObject({ saved: "Final cut.mp4", item_id: "out" });
  });
});

describe("media between the Space and the chat's folder", () => {
  it("copies a Media file into the chat's folder", async () => {
    hoisted.invoke.mockResolvedValue("/chats/c1/media/clip.mp4");
    await expect(call(tool("media.fetch"), { space: "s1", item_id: "m1" })).resolves.toEqual({
      path: "/chats/c1/media/clip.mp4",
      name: "clip.mp4",
      type: "video/mp4",
      bytes: 3,
    });
    const [command, body, options] = hoisted.invoke.mock.calls[0];
    expect(command).toBe("chat_media_save");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(options.headers).toMatchObject({ "x-conversation": "c1", "x-file-name": "clip.mp4" });
  });

  it("adds a file the agent made to Media, credited to it", async () => {
    hoisted.invoke.mockResolvedValue(new Uint8Array([1, 2]).buffer);
    await expect(
      call(tool("file.upload"), { space: "s1", path: "out/voice.wav" }),
    ).resolves.toMatchObject({ saved: "voice.wav", item_id: "out" });
    expect(hoisted.invoke).toHaveBeenCalledWith("chat_media_load", {
      account: "acct",
      conversation: "c1",
      path: "out/voice.wav",
    });
    expect(hoisted.gateway.uploadLibraryBlob).toHaveBeenCalledWith(
      "s1",
      expect.any(Blob),
      "voice.wav",
      "library",
      { agent: expect.objectContaining({ agent_id: "ag", kind: "file" }) },
    );
  });

  it("says why a file outside the chat's folder isn't added", async () => {
    hoisted.invoke.mockRejectedValue("Only files in this chat's own folder can be added to Media.");
    await expect(call(tool("file.upload"), { space: "s1", path: "/etc/hosts" })).rejects.toSatisfy(
      (error) => refusal(error).includes("own folder"),
    );
  });
});
