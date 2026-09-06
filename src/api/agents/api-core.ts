export function createAgentsApi(
  apiRequest: <T = void>(path: string, init?: RequestInit) => Promise<T>,
  apiBlobRequest: (path: string) => Promise<Blob> = async () => {
    throw new Error("Use the binary operation.");
  },
) {
  return {
    list: <T>() => apiRequest<{ agents: T[] }>("/agents"),
    avatar: (id: string, version: number) =>
      apiBlobRequest(
        `/agents/${encodeURIComponent(id)}/avatar?version=${encodeURIComponent(version)}`,
      ),
    activity: <T>(id: string, limit = 30) =>
      apiRequest<T>(
        `/agents/${encodeURIComponent(id)}/activity?limit=${encodeURIComponent(limit)}`,
      ),
    run: <T>(runId: string) => apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}`),
    cancelRun: <T>(runId: string) =>
      apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
    retryRun: <T>(runId: string) =>
      apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/retry`, { method: "POST" }),
    decideApproval: <T>(runId: string, approvalId: string, decision: "approve" | "deny") =>
      apiRequest<T>(
        `/agent-runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
        { method: "POST", body: JSON.stringify({ decision }) },
      ),
    transcribeVoice: async (audio: Blob, durationMs: number) =>
      apiRequest<{ transcript: string; detected_language: string; duration_ms: number }>(
        "/agent-voice/transcriptions",
        {
          method: "POST",
          body: JSON.stringify({
            audio_base64: arrayBufferToBase64(await audio.arrayBuffer()),
            mime_type: audio.type || "audio/webm",
            duration_ms: durationMs,
          }),
        },
      ),
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return window.btoa(binary);
}
