import { createDeviceSetting } from "@/shared/lib/deviceSetting";

export const useEditorWordWrap = createDeviceSetting<boolean>({
  scope: "editor-word-wrap",
  defaults: true,
  normalize: (stored) => stored !== false,
});
