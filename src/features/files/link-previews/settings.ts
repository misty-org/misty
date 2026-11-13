import { create } from "zustand";

/** Device setting: show a card under links in replies and chats. Configured from the settings document. */
export const useLinkPreviewSetting = create<{ enabled: boolean }>(() => ({ enabled: true }));

export function configureLinkPreviews(enabled: boolean): void {
  useLinkPreviewSetting.setState({ enabled });
}
