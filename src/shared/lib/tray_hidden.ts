import { createDeviceSetting } from "@/shared/lib/device_setting";

export const useTrayHidden = createDeviceSetting<boolean>({
  scope: "tray-hidden",
  defaults: false,
  normalize: (stored) => stored === true,
});
