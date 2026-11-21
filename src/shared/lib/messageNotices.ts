import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** What Misty tells the person about chat messages while they are away; kept for this device. */
export interface MessageNoticePrefs {
  /** Notices for messages in DMs. */
  direct: boolean;
  /** Notices for messages in a Space: only those that name the person, every one, or none. */
  spaces: "mentions" | "all" | "off";
  /** Spaces, DMs and Space channels (`chatMuteId`) the person muted, by id. */
  muted: string[];
}

export const useMessageNotices = createDeviceSetting<MessageNoticePrefs>({
  scope: "message-notices",
  defaults: { direct: true, spaces: "mentions", muted: [] },
  normalize: (stored) => {
    const value = (stored && typeof stored === "object" ? stored : {}) as Partial<MessageNoticePrefs>;
    return {
      direct: value.direct !== false,
      spaces: value.spaces === "all" || value.spaces === "off" ? value.spaces : "mentions",
      muted: Array.isArray(value.muted) ? value.muted.filter((id) => typeof id === "string") : [],
    };
  },
});

/** Mutes or unmutes one Space or DM's notices. */
export function setMuted(spaceId: string, muted: boolean): void {
  useMessageNotices.getState().set((current) => ({
    ...current,
    muted: muted
      ? [...current.muted.filter((id) => id !== spaceId), spaceId]
      : current.muted.filter((id) => id !== spaceId),
  }));
}

/** What mutes one channel of a Space: the main chat when `conversationId` is empty. */
export function chatMuteId(spaceId: string, conversationId = ""): string {
  return `${spaceId}/${conversationId || "everyone"}`;
}
