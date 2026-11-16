import { createPort } from "@/shared/lib/seams";

/** The id of this computer's agent device; agents own the device, so they fill this in. */
export const voiceDevice = createPort<() => Promise<string>>("this computer's device id");

type CleanupBody = { text: string; style: string; dictionary: string[]; language: string };

/**
 * Tidies one dictation on the default engine; agents own the engines, so they fill this in. With
 * nothing provided the words stay as they were.
 */
export const voiceCleanup = createPort<
  (body: CleanupBody, signal?: AbortSignal) => Promise<{ text: string }>
>("dictation cleanup on the default engine");

export const voiceApi = {
  cleanup: (body: CleanupBody, signal?: AbortSignal) =>
    voiceCleanup.maybe()?.(body, signal) ?? Promise.resolve({ text: body.text }),
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
