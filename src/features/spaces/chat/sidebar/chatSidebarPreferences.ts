import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * The channel column's choices, kept in `misty.db` for this device and the same in every Space:
 * `direct` is which list the toggle shows (direct messages when true, channels when false, the
 * one holding the open chat until the person flips it); `hideMembers` folds the member list
 * away. Earlier versions kept sections' folds
 * here, read from webview storage once; those keys are dropped.
 */
export const useChatSidebarPreferences = createDeviceSetting<Record<string, boolean>>({
  scope: "spaces.chat.sidebar",
  defaults: {},
  legacyKey: "misty:chat-sidebar-choices",
  normalize: (stored) => {
    const choices: Record<string, boolean> = {};
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return choices;
    for (const key of ["direct", "hideMembers"]) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === "boolean") choices[key] = value;
    }
    return choices;
  },
});
