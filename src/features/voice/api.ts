import { apiRequest } from "@/api/client";
import { agentsDeviceSnapshot, ensureServerAgentDevice } from "@/features/agents";
import type { LiveChannel } from "./liveTranscriber";

export interface LiveTicket {
  ticket: string;
  /** The relay's WebSocket address. */
  url: string;
  expires_in: number;
  max_ms: number;
}

export const voiceApi = {
  liveTicket: (
    body: { device_id: string; channels: LiveChannel[]; language: string },
    signal?: AbortSignal,
  ) =>
    apiRequest<LiveTicket>("/me/voice/live/ticket", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  cleanup: (
    body: { text: string; style: string; dictionary: string[]; language: string },
    signal?: AbortSignal,
  ) =>
    apiRequest<{ text: string }>("/me/voice/cleanup", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
};

let device: Promise<string> | undefined;

/** This device's server id, which tickets are bound to. */
export function voiceDeviceId(): Promise<string> {
  device ??= (async () => {
    const snapshot = await agentsDeviceSnapshot();
    if (!snapshot.device || snapshot.device.status === "revoked")
      throw new Error("Add this device to your account to use voice.");
    return (await ensureServerAgentDevice(snapshot.device)).id;
  })().catch((error) => {
    device = undefined;
    throw error;
  });
  return device;
}
