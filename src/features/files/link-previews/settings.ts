import { create } from "zustand";

export const useLinkPreviewSetting = create<{ enabled: boolean }>(() => ({ enabled: true }));

export function configureLinkPreviews(enabled: boolean): void {
  useLinkPreviewSetting.setState({ enabled });
}
