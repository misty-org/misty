import { createPort } from "@/shared/lib/seams";

export const voiceDevice = createPort<() => Promise<string>>("this computer's device id");

type CleanupBody = { text: string; style: string; dictionary: string[]; language: string };

export const voiceCleanup = createPort<
  (body: CleanupBody, signal?: AbortSignal) => Promise<{ text: string }>
>("dictation cleanup on the default engine");

export const voiceApi = {
  cleanup: (body: CleanupBody, signal?: AbortSignal) =>
    voiceCleanup.maybe()?.(body, signal) ?? Promise.resolve({ text: body.text }),
};

let device: Promise<string> | undefined;

export function voiceDeviceId(): Promise<string> {
  device ??= (async () => {
    return voiceDevice.get()();
  })().catch((error) => {
    device = undefined;
    throw error;
  });
  return device;
}
