import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** Whether the person hid Misty's menu bar icon on this device. */
export const useTrayHidden = createDeviceSetting<boolean>({
  scope: "tray-hidden",
  defaults: false,
  normalize: (stored) => stored === true,
});
