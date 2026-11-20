import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Whether the person's status is Do not disturb, mirrored for this device so native-bound notices
 * can stay quiet without asking the server. Settings › Profile › Status keeps it in step with the
 * status chosen on the account.
 */
export const useDoNotDisturb = createDeviceSetting<boolean>({
  scope: "do-not-disturb",
  defaults: false,
  normalize: (stored) => stored === true,
});
