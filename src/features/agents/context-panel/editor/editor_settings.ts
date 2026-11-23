import { createDeviceSetting } from "@/shared/lib/device_setting";

export const useEditorWordWrap = createDeviceSetting<boolean>({
  scope: "editor-word-wrap",
  defaults: true,
  normalize: (stored) => stored !== false,
});
