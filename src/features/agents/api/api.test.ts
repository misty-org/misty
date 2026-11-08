import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, deviceModelCall } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  deviceModelCall: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest,
  apiBlobRequest: vi.fn(),
}));
vi.mock("@/api/runtime/device-models", () => ({ deviceModelCall }));

import { agentsApi } from "./api";

describe("agentsApi voice transcription", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transcribes a recording on this computer's runtime, never the server", async () => {
    deviceModelCall.mockResolvedValue({ transcript: "hello" });
    await agentsApi.transcribeVoice(new Blob(["voice"], { type: "audio/webm" }), 1200);

    expect(apiRequest).not.toHaveBeenCalled();
    expect(deviceModelCall).toHaveBeenCalledWith(
      "voice-transcription",
      { audio_base64: "dm9pY2U=", mime_type: "audio/webm", duration_ms: 1200 },
      undefined,
    );
  });
});
