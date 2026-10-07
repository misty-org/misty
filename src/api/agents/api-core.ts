export function createAgentsApi(
  apiRequest: <T = void>(path: string, init?: RequestInit) => Promise<T>,
) {
  return {
    realtimeVoiceTicket: (deviceId: string, signal?: AbortSignal) =>
      apiRequest<{ ticket: string; expires_in: number }>("/agent-voice/realtime/ticket", {
        method: "POST",
        signal,
        body: JSON.stringify({ device_id: deviceId }),
      }),
    run: <T>(runId: string) => apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}`),
    cancelRun: <T>(runId: string) =>
      apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
    transcribeVoice: async (audio: Blob, durationMs: number, signal?: AbortSignal) =>
      apiRequest<{ transcript: string; detected_language: string; duration_ms: number }>(
        "/agent-voice/transcriptions",
        {
          signal,
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
