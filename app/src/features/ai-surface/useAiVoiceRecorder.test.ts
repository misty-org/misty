import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { transcribeVoice } = vi.hoisted(() => ({ transcribeVoice: vi.fn() }));

vi.mock("@/api/agents/api", () => ({
  agentsApi: { transcribeVoice },
}));

import { useAiVoiceRecorder } from "./useAiVoiceRecorder";

describe("useAiVoiceRecorder", () => {
  const trackStop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    transcribeVoice.mockResolvedValue({ transcript: "hello Misty" });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: trackStop }],
        }),
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: "audioinput", deviceId: "default", label: "Default - Aggregate Device" },
          { kind: "audioinput", deviceId: "built-in", label: "MacBook Pro Microphone" },
        ]),
      },
    });
    vi.stubGlobal("MediaRecorder", TestMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the voice surface active through permission, recording, and transcription", async () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const onActivityChange = vi.fn();
    const { result } = renderHook(() =>
      useAiVoiceRecorder({ onTranscript, onError, onActivityChange }),
    );

    await act(async () => result.current.start());
    expect(onActivityChange).toHaveBeenCalledWith(true);
    expect(result.current.recording).toBe(true);

    act(() => result.current.stop());
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hello Misty"));

    expect(transcribeVoice).toHaveBeenCalledWith(expect.any(Blob), expect.any(Number));
    expect((transcribeVoice.mock.calls[0]?.[0] as Blob).type).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(onActivityChange).toHaveBeenLastCalledWith(false);
    expect(trackStop).toHaveBeenCalled();
  });

  it("explains a denied microphone permission", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(denied);
    const onError = vi.fn();
    const onActivityChange = vi.fn();
    const { result } = renderHook(() =>
      useAiVoiceRecorder({ onTranscript: vi.fn(), onError, onActivityChange }),
    );

    await act(async () => result.current.start());

    expect(onError).toHaveBeenLastCalledWith(
      "Microphone access is off. Allow it for Misty in System Settings, then try again.",
    );
    expect(onActivityChange).toHaveBeenLastCalledWith(false);
    expect(result.current.requesting).toBe(false);
  });

  it("records from the selected microphone and persists that choice", async () => {
    const { result } = renderHook(() =>
      useAiVoiceRecorder({ onTranscript: vi.fn(), onError: vi.fn() }),
    );

    await waitFor(() =>
      expect(result.current.inputDevices).toEqual([
        { deviceId: "built-in", label: "MacBook Pro Microphone" },
      ]),
    );
    act(() => result.current.selectInputDevice("built-in"));
    await act(async () => result.current.start());

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: "built-in" } },
    });
    expect(window.localStorage.getItem("misty.voice.input-device")).toBe("built-in");
  });
});

class TestMediaRecorder {
  static isTypeSupported(mimeType: string) {
    return mimeType.startsWith("audio/mp4");
  }

  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.();
  }
}
