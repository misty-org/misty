import { createDeviceSetting } from "@/shared/lib/device_setting";

export interface MessageNoticePrefs {
  direct: boolean;
  spaces: "mentions" | "all" | "off";
  muted: string[];
}

export const useMessageNotices = createDeviceSetting<MessageNoticePrefs>({
  scope: "message-notices",
  defaults: { direct: true, spaces: "mentions", muted: [] },
  normalize: (stored) => {
    const value = (
      stored && typeof stored === "object" ? stored : {}
    ) as Partial<MessageNoticePrefs>;
    return {
      direct: value.direct !== false,
      spaces: value.spaces === "all" || value.spaces === "off" ? value.spaces : "mentions",
      muted: Array.isArray(value.muted) ? value.muted.filter((id) => typeof id === "string") : [],
    };
  },
});

export function setMuted(spaceId: string, muted: boolean): void {
  useMessageNotices.getState().set((current) => ({
    ...current,
    muted: muted
      ? [...current.muted.filter((id) => id !== spaceId), spaceId]
      : current.muted.filter((id) => id !== spaceId),
  }));
}

export function chatMuteId(spaceId: string, conversationId = ""): string {
  return `${spaceId}/${conversationId || "everyone"}`;
}
