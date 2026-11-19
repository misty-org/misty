import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** Vim keys in Misty's code editors, kept for this device in `misty.db`. Off until turned on. */
export const useEditorVim = createDeviceSetting<boolean>({
  scope: "editor-vim",
  defaults: false,
  normalize: (stored) => stored === true,
});

/** Long lines wrap in the code editor, kept for this device. On until turned off. */
export const useEditorWordWrap = createDeviceSetting<boolean>({
  scope: "editor-word-wrap",
  defaults: true,
  normalize: (stored) => stored !== false,
});

/**
 * Whether vim mode also takes the person's own Neovim mappings and options from their config
 * folder. On by default once vim is: it only reads what they wrote, never a plugin's.
 */
export const useEditorNvimMappings = createDeviceSetting<boolean>({
  scope: "editor-nvim-mappings",
  defaults: true,
  normalize: (stored) => stored !== false,
});
