import { useCallback, useEffect, useState } from "react";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export const useSavedInputDevice = createDeviceSetting<string>({
  scope: "voice-input-device",
  defaults: "",
  normalize: (stored) => (typeof stored === "string" ? stored.trim() : ""),
  legacyKey: "misty.voice.input-device",
});

export interface InputDevice {
  deviceId: string;
  label: string;
}

export function useInputDevices(): { devices: InputDevice[]; refresh: () => Promise<void> } {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const available = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput" && device.deviceId !== "default",
      );
      setDevices(
        available.map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label.trim() || `Microphone ${index + 1}`,
        })),
      );
    } catch {}
  }, []);
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);
  return { devices, refresh };
}
