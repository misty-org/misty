import { deviceModelCall } from "@/api/runtime/device-models";

export function createAgentsApi() {
  return {
    /** Transcribes a spoken request on this computer's transcription model. */
    transcribeVoice: async (audio: Blob, durationMs: number, signal?: AbortSignal) =>
      deviceModelCall<{ transcript: string; detected_language: string; duration_ms: number }>(
        "voice-transcription",
        {
          audio_base64: arrayBufferToBase64(await audio.arrayBuffer()),
          mime_type: audio.type || "audio/webm",
          duration_ms: durationMs,
        },
        signal,
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
