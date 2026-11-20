import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Whether this computer shows the person (their cursor and face) to others in a live session. It
 * is read when a session is joined, so a change applies from the next one.
 */
export const useShowInLive = createDeviceSetting<boolean>({
  scope: "live-show-me",
  defaults: true,
  normalize: (stored) => stored !== false,
});
