import type { KeyboardEvent, RefObject } from "react";
import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { vimKey, vimStart, type VimState } from "./vimKeys";

/** Whether the composer takes Vim keys (`/vim`), kept for this device in `misty.db`. */
const savedVim = createDeviceSetting<boolean>({
  scope: "composer-vim",
  defaults: false,
  normalize: (stored) => stored === true,
});

/**
 * Vim keys in the composer: on or off for the device, and the mode and register while typing.
 * Each window keeps its own mode; a sent message starts the next one in insert mode.
 */
export const useComposerVim = create<{
  on: boolean;
  state: VimState;
  toggle(on?: boolean): void;
  reset(): void;
}>((set, get) => ({
  on: savedVim.getState().value,
  state: vimStart(),
  toggle: (on = !get().on) => {
    restored = true;
    set({ on, state: vimStart() });
    savedVim.getState().set(on);
  },
  reset: () => set({ state: { ...get().state, mode: "insert", pending: "" } }),
}));

let restored = false;
savedVim.subscribe(({ value, loaded }) => {
  if (!loaded || restored) return;
  restored = true;
  useComposerVim.setState({ on: value });
});

/**
 * Applies a key to the composer when Vim keys are on. Returns true when Vim took it, so the
 * composer neither types it nor sends.
 */
export function handleVimKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setText: (text: string) => void,
): boolean {
  const vim = useComposerVim.getState();
  if (!vim.on || event.metaKey || event.ctrlKey || event.altKey) return false;
  const area = textareaRef.current;
  if (!area) return false;
  const edit = vimKey(event.key, area.value, area.selectionStart ?? 0, vim.state);
  if (!edit) return false;
  event.preventDefault();
  useComposerVim.setState({ state: edit.state });
  if (edit.text !== area.value) setText(edit.text);
  requestAnimationFrame(() => {
    const current = textareaRef.current;
    current?.setSelectionRange(edit.caret, edit.caret);
  });
  return true;
}
