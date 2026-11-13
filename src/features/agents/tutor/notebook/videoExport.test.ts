import { afterEach, describe, expect, it, vi } from "vitest";
import { recordVideo, sceneSeconds, svgUrl } from "./videoExport";

vi.mock("../tutorAudio", () => ({ sceneAudioBytes: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe("a video overview's timing", () => {
  it("runs a voiced scene as long as its narration, with a breath after", () => {
    expect(sceneSeconds({ heading: "a", narration: "anything", seconds: 10 })).toBeCloseTo(10.6);
  });

  it("holds an unvoiced scene for reading time, at least four seconds", () => {
    expect(sceneSeconds({ heading: "a", narration: "Short." })).toBe(4);
    const words = Array.from({ length: 26 }, () => "word").join(" ");
    expect(sceneSeconds({ heading: "a", narration: words })).toBeCloseTo(11.5);
  });
});

describe("saving a video", () => {
  it("shows a drawing as a data address", () => {
    expect(svgUrl("<svg a='1'/>")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg a='1'/>")}`,
    );
  });

  it("says so when this system can't record video", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    await expect(
      recordVideo(
        {
          id: "v",
          kind: "video",
          title: "Lava",
          body: "",
          scenes: [{ heading: "a", narration: "b" }],
          createdAt: "",
          updatedAt: "",
        },
        vi.fn(),
      ),
    ).rejects.toThrow("This system can't record video.");
  });

  it("looks for MP4 first, then WebM", async () => {
    const isTypeSupported = vi.fn((type: string) => type === "video/webm");
    vi.stubGlobal("MediaRecorder", { isTypeSupported });
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    await expect(
      recordVideo(
        { id: "v", kind: "video", title: "Lava", body: "", createdAt: "", updatedAt: "" },
        vi.fn(),
      ),
    ).rejects.toThrow("Misty couldn't draw the video.");
    expect(isTypeSupported.mock.calls.map(([type]) => type)).toEqual([
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ]);
    getContext.mockRestore();
  });
});
