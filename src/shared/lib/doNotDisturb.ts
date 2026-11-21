import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Whether the person's chosen status is Do not disturb, kept for this device. A flag outside the
 * features so the ones that notify (agent runs, messages) can stay quiet without importing the
 * status code: the status store (`features/direct`) sets it whenever the chosen status changes.
 */
export const useDoNotDisturb = createDeviceSetting<boolean>({
  scope: "do-not-disturb",
  defaults: false,
  normalize: (stored) => stored === true,
});
