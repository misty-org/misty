import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Which chat sidebar sections are collapsed, kept in `misty.db` for this device and the same in
 * every Space. Earlier versions kept it in webview storage, which moves in once.
 */
export const useChatSidebarPreferences = createDeviceSetting<Record<string, boolean>>({
  scope: "spaces.chat.sidebar",
  defaults: {},
  legacyKey: "misty:chat-sidebar-collapsed",
  normalize: (stored) => {
    const collapsed: Record<string, boolean> = {};
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return collapsed;
    for (const [id, value] of Object.entries(stored)) if (value === true) collapsed[id] = true;
    return collapsed;
  },
});
