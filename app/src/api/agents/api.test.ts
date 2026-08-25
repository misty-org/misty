import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/api/client", () => ({
  apiRequest,
  apiBlobRequest: vi.fn(),
}));

import { agentsApi } from "./api";

describe("agentsApi voice transport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends bounded recordings through the WebKit-safe JSON transport", async () => {
    apiRequest.mockResolvedValue({ transcript: "hello" });
    await agentsApi.transcribeVoice(new Blob(["voice"], { type: "audio/webm" }), 1200);

    expect(apiRequest).toHaveBeenCalledWith(
      "/agent-voice/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
    const init = apiRequest.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      audio_base64: "dm9pY2U=",
      mime_type: "audio/webm",
      duration_ms: 1200,
    });
  });
});
