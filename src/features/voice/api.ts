import { deviceModelCall } from "@/api/runtime/device-models";
import { createPort } from "@/shared/lib/seams";

/** The id of this computer's agent device; agents own the device, so they fill this in. */
export const voiceDevice = createPort<() => Promise<string>>("this computer's device id");

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
    return voiceDevice.get()();
  })().catch((error) => {
    device = undefined;
    throw error;
  });
  return device;
}
