import { deviceModelCall } from "@/api/device-models";
import { agentsDeviceSnapshot, ensureAgentDevice } from "@/features/agents";

export const voiceApi = {
  /** Tidies one dictation on this computer's fast model. */
  cleanup: (
    body: { text: string; style: string; dictionary: string[]; language: string },
    signal?: AbortSignal,
  ) => deviceModelCall<{ text: string }>("cleanup", body, signal),
};

let device: Promise<string> | undefined;

/** This device's server id. Voice needs a signed-in device. */
export function voiceDeviceId(): Promise<string> {
  device ??= (async () => {
    const snapshot = await agentsDeviceSnapshot();
    if (!snapshot.device || snapshot.device.status === "revoked")
      throw new Error("Sign in on this computer to use voice.");
    return (await ensureAgentDevice(snapshot.device)).id;
  })().catch((error) => {
    device = undefined;
    throw error;
  });
  return device;
}
