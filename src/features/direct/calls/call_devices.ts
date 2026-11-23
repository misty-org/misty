import { useCallback, useEffect, useState } from "react";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { savedInputDevice } from "@/features/voice";

export type CallDeviceKind = "audioinput" | "audiooutput" | "videoinput";

const normalize = (stored: unknown) => (typeof stored === "string" ? stored.trim() : "");

export const savedSpeaker = createDeviceSetting<string>({
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

export const savedCallAudio = createDeviceSetting<CallAudio>({
  scope: "call-audio-state",
  defaults: { muted: false, deafened: false },
  normalize: (stored) => {
    const value = (stored ?? {}) as Partial<CallAudio>;
    return { muted: value.muted === true, deafened: value.deafened === true };
  },
});

export async function rememberSpeaker(deviceId: string) {
  savedSpeaker.getState().set(deviceId);
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

export const savedCamera = createDeviceSetting<string>({
  scope: "call-video-input-device",
  defaults: "",
  normalize,
});

export const savedCallDevice = {
  audioinput: savedInputDevice,
  audiooutput: savedSpeaker,
  videoinput: savedCamera,
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

export const canPickSpeaker = () =>
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export function useCallDevices(kind: CallDeviceKind): CallDevice[] {
  const [devices, setDevices] = useState<CallDevice[]>([]);
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const found = (await navigator.mediaDevices.enumerateDevices()).filter(
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

export const savedNoiseReduction = createDeviceSetting<boolean>({
  scope: "call-noise-reduction",
  defaults: true,
  normalize: (stored) => stored !== false,
});
