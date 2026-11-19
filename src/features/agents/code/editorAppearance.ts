import { editorFonts, editorThemes } from "@/shared/lib/codemirror/editorThemes";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** The Code page editor's color theme, kept for this device in `misty.db`. Misty's by default. */
export const useEditorTheme = createDeviceSetting<string>({
  scope: "editor-theme",
  defaults: "misty",
  normalize: (stored) =>
    typeof stored === "string" && editorThemes.some((theme) => theme.value === stored)
      ? stored
      : "misty",
});

/** The Code page editor's font, kept for this device. JetBrains Mono, bundled, by default. */
export const useEditorFont = createDeviceSetting<string>({
  scope: "editor-font",
  defaults: "jetbrains-mono",
  normalize: (stored) =>
    typeof stored === "string" && editorFonts.some((font) => font.value === stored)
      ? stored
      : "jetbrains-mono",
});
