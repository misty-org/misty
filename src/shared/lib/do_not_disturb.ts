import { createDeviceSetting } from "@/shared/lib/device_setting";

export const useDoNotDisturb = createDeviceSetting<boolean>({
  scope: "do-not-disturb",
  defaults: false,
  normalize: (stored) => stored === true,
});
