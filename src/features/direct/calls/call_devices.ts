import { useCallback, useEffect, useState } from "react";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useSavedInputDevice } from "@/features/voice";
import { microphoneSettingsHint } from "@/shared/platform/desktop_os";

export type CallDeviceKind = "audioinput" | "audiooutput" | "videoinput";

const normalize = (stored: unknown) => (typeof stored === "string" ? stored.trim() : "");

export const useSavedSpeaker = createDeviceSetting<string>({
  scope: "call-audio-output-device",
  defaults: "",
  normalize,
});

export const savedSpeakerName = createDeviceSetting<string>({
  scope: "call-audio-output-name",
  defaults: "",
  normalize,
});

export interface CallAudio {
  muted: boolean;
  deafened: boolean;
}

export const useSavedCallAudio = createDeviceSetting<CallAudio>({
  scope: "call-audio-state",
  defaults: { muted: false, deafened: false },
  normalize: (stored) => {
    const value = (stored ?? {}) as Partial<CallAudio>;
    return { muted: value.muted === true, deafened: value.deafened === true };
  },
});

export async function rememberSpeaker(deviceId: string) {
  useSavedSpeaker.getState().set(deviceId);
  let label = "";
  try {
    const found = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    label =
      found.find((device) => device.kind === "audiooutput" && device.deviceId === deviceId)
        ?.label ?? "";
  } catch {
    label = "";
  }
  savedSpeakerName.getState().set(deviceId ? label.trim() : "");
}

export function watchSpeakerForSpeech(): () => void {
  if (!hasTauriInternals()) return () => undefined;
  const send = (name: string) =>
    void invoke("speech_output_device", { name: name || null }).catch(() => undefined);
  send(savedSpeakerName.getState().value);
  return savedSpeakerName.subscribe((state, previous) => {
    if (state.value !== previous.value) send(state.value);
  });
}

export const useSavedCamera = createDeviceSetting<string>({
  scope: "call-video-input-device",
  defaults: "",
  normalize,
});

export const savedCallDevice = {
  audioinput: useSavedInputDevice,
  audiooutput: useSavedSpeaker,
  videoinput: useSavedCamera,
} as const;

export interface CallDevice {
  deviceId: string;
  label: string;
}

const fallbackName: Record<CallDeviceKind, string> = {
  audioinput: "Microphone",
  audiooutput: "Speaker",
  videoinput: "Camera",
};

export function microphoneFailure(error: unknown, fallback: string): string {
  console.warn("Call microphone failed", error);
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError")
    return `Misty isn’t allowed to use the microphone. ${microphoneSettingsHint()}`;
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found.";
  if (name === "NotReadableError")
    return "The microphone couldn’t be opened. Another app may be using it.";
  return fallback;
}

export const canPickSpeaker = () =>
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

let audioAccess: Promise<void> | undefined;

function askForAudioAccess(): Promise<void> {
  audioAccess ??= (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  })().catch(() => undefined);
  return audioAccess;
}

const hiddenUntilAllowed = (devices: MediaDeviceInfo[], kind: CallDeviceKind) =>
  kind !== "videoinput" &&
  devices.some((device) => device.kind === kind && (!device.deviceId || !device.label));

export function useCallDevices(kind: CallDeviceKind): CallDevice[] {
  const [devices, setDevices] = useState<CallDevice[]>([]);
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let all = await navigator.mediaDevices.enumerateDevices();
      if (hiddenUntilAllowed(all, kind) && "getUserMedia" in navigator.mediaDevices) {
        await askForAudioAccess();
        all = await navigator.mediaDevices.enumerateDevices();
      }
      const found = all.filter(
        (device) => device.kind === kind && device.deviceId && device.deviceId !== "default",
      );
      setDevices(
        found.map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label.trim() || `${fallbackName[kind]} ${index + 1}`,
        })),
      );
    } catch {
      setDevices([]);
    }
  }, [kind]);
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);
  return devices;
}

export const useSavedNoiseReduction = createDeviceSetting<boolean>({
  scope: "call-noise-reduction",
  defaults: true,
  normalize: (stored) => stored !== false,
});
