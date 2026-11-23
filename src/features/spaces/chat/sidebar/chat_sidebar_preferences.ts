import { createDeviceSetting } from "@/shared/lib/device_setting";

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
