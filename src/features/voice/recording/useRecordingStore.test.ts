import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const upload = vi.fn();
const record = vi.fn();
const link = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/api/spaces/library-upload", () => ({
  uploadLibraryPath: (...args: unknown[]) => upload(...args),
}));
vi.mock("@/features/recall", () => ({
  memoryApi: { record: (...args: unknown[]) => record(...args) },
}));
vi.mock("@/features/spaces", () => ({
  useSpacesStore: {
    getState: () => ({
      spaces: [
        { id: "shared", is_default: false, role: "owner" },
        { id: "mine", is_default: true, role: "owner" },
      ],
    }),
  },
}));
vi.mock("../capture/captureApi", () => ({
  captureApi: { recordingItem: (...args: unknown[]) => link(...args) },
}));
const capture = {
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  makeNote: vi.fn(async () => {}),
  transcriptId: "t1",
  phase: "live",
  notice: undefined as string | undefined,
};
vi.mock("../capture/useCaptureStore", () => ({ useCaptureStore: { getState: () => capture } }));

const { useRecordingStore, RECORDING_UPLOAD_LIMIT } = await import("./useRecordingStore");

function stopped(bytes: number) {
  invoke.mockImplementation(async (command: string) => {
    if (command === "voice_recording_start") return "/cache/recordings/recording-1.mp4";
    if (command === "voice_recording_stop")
      return { path: "/cache/recordings/recording-1.mp4", seconds: 125, bytes };
  });
}

describe("screen recording sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upload.mockResolvedValue({ item: { id: "item-1" } });
    link.mockResolvedValue(undefined);
    record.mockResolvedValue({});
    useRecordingStore.setState({ phase: "idle", path: undefined, notice: undefined });
  });

  it("puts the video in the person's own Library, links it, summarizes and remembers it", async () => {
    stopped(5_000_000);
    await useRecordingStore.getState().start({ microphone: true, language: "auto" });
    expect(capture.start).toHaveBeenCalledWith(
      { kind: "recording", title: "Screen recording", mic: true },
      "auto",
    );
    await useRecordingStore.getState().stop();
    expect(upload).toHaveBeenCalledWith("mine", "/cache/recordings/recording-1.mp4", "library");
    expect(link).toHaveBeenCalledWith("t1", "item-1");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "recording",
        ref_id: "item-1",
        title: "Screen recording, 2 min",
      }),
    );
    expect(invoke).toHaveBeenCalledWith("voice_recording_discard", {
      path: "/cache/recordings/recording-1.mp4",
    });
    expect(capture.makeNote).toHaveBeenCalledWith("summary");
    expect(useRecordingStore.getState().phase).toBe("idle");
  });

  it("keeps a recording that is too large to upload, and says where", async () => {
    stopped(RECORDING_UPLOAD_LIMIT + 1);
    await useRecordingStore.getState().start({ microphone: false, language: "en" });
    await useRecordingStore.getState().stop();
    expect(upload).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("voice_recording_discard", expect.anything());
    expect(useRecordingStore.getState().notice).toContain("/cache/recordings/recording-1.mp4");
  });

  it("stops the screen if listening can't start", async () => {
    stopped(1);
    capture.start.mockImplementationOnce(async () => {
      Object.assign(capture, {
        phase: "idle",
        notice: "Add this device to your account to use voice.",
      });
    });
    await useRecordingStore.getState().start({ microphone: true, language: "auto" });
    expect(invoke).toHaveBeenCalledWith("voice_recording_stop", {
      path: "/cache/recordings/recording-1.mp4",
    });
    expect(useRecordingStore.getState()).toMatchObject({
      phase: "idle",
      notice: "Add this device to your account to use voice.",
    });
    Object.assign(capture, { phase: "live", notice: undefined });
  });
});
