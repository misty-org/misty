import { invoke } from "@tauri-apps/api/core";
import { deviceModelCall } from "@/api/device-models";
import { agentsDeviceSnapshot, ensureServerAgentDevice } from "@/features/agents";
import type { LiveChannel } from "./liveTranscriber";

interface LiveTicket {
  ticket: string;
  /** The relay's WebSocket address. */
  url: string;
  expires_in: number;
  max_ms: number;
}

export const voiceApi = {
  /** A one-time ticket for the live transcription relay on this computer's agent runtime,
   * which streams on this device's Soniox key. */
  liveTicket: (body: { device_id: string; channels: LiveChannel[]; language: string }) =>
    invoke<LiveTicket>("agent_runtime_live_ticket", {
      channels: body.channels,
      language: body.language,
    }),
  /** Tidies one dictation on this computer's fast model. */
  cleanup: (
    body: { text: string; style: string; dictionary: string[]; language: string },
    signal?: AbortSignal,
  ) => deviceModelCall<{ text: string }>("cleanup", body, signal),
};

let device: Promise<string> | undefined;

/** This device's server id, which tickets are bound to. */
export function voiceDeviceId(): Promise<string> {
  device ??= (async () => {
    const snapshot = await agentsDeviceSnapshot();
    if (!snapshot.device || snapshot.device.status === "revoked")
      throw new Error("Sign in on this computer to use voice.");
    return (await ensureServerAgentDevice(snapshot.device)).id;
  })().catch((error) => {
    device = undefined;
    throw error;
  });
  return device;
}
