import { create } from "zustand";
import { resolveDirectAddress } from "./address";

export const useBrowserSearchStore = create<{
  open: boolean;
  show(): void;
  close(): void;
  toggle(): void;
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set((state) => ({ open: !state.open })),
}));

/** No requests are made while typing. Enter alone submits the chosen URL or
 * search phrase to Google. The launcher never evaluates a typed script URL. */
export function browserSearchDestination(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const direct = resolveDirectAddress(value);
  if (direct) {
    const url = new URL(direct);
    if (url.protocol === "http:" || url.protocol === "https:" || url.href === "about:blank")
      return url.href;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
