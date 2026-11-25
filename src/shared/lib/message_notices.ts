import { notify } from "@misty/ui";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export interface MessageNoticePrefs {
  direct: boolean;
  spaces: "mentions" | "all" | "off";
  sound: boolean;
  badge: boolean;
  muted: string[];
}

export const useMessageNotices = createDeviceSetting<MessageNoticePrefs>({
  scope: "message-notices",
  defaults: { direct: true, spaces: "mentions", sound: true, badge: true, muted: [] },
  normalize: (stored) => {
    const value = (
      stored && typeof stored === "object" ? stored : {}
    ) as Partial<MessageNoticePrefs>;
    return {
      direct: value.direct !== false,
      spaces: value.spaces === "all" || value.spaces === "off" ? value.spaces : "mentions",
      sound: value.sound !== false,
      badge: value.badge !== false,
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

export function muteWithNotice(muteId: string, message: string): void {
  setMuted(muteId, true);
  notify({
    id: `mute-${muteId}`,
    message,
    action: { label: "Undo", onSelect: () => setMuted(muteId, false) },
  });
}

export function chatMuteId(spaceId: string, conversationId = ""): string {
  return `${spaceId}/${conversationId || "everyone"}`;
}

export function noticesMuted(
  prefs: MessageNoticePrefs,
  spaceId: string,
  conversationId?: string,
): boolean {
  if (prefs.muted.includes(spaceId)) return true;
  return conversationId !== undefined && prefs.muted.includes(chatMuteId(spaceId, conversationId));
}

export function useMuted(spaceId: string, muteId: string, notice: string) {
  const space = useMessageNotices((state) => state.value.muted.includes(spaceId));
  const own = useMessageNotices((state) => state.value.muted.includes(muteId));
  const bySpace = space && muteId !== spaceId;
  return {
    muted: space || own,
    bySpace,
    toggle: () => (own ? setMuted(muteId, false) : muteWithNotice(muteId, notice)),
  };
}
