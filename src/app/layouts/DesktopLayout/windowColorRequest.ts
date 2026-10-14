import { create } from "zustand";
import type { WindowColor } from "@/features/workspace";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

type WindowColorRequest = { kind: "create" } | { kind: "edit"; windowId: string };

interface WindowColorState {
  request: WindowColorRequest | null;
  /** The color being tried: it tints the window live, but is kept only on Save. */
  preview: WindowColor | null;
  ask(request: WindowColorRequest): void;
  setPreview(color: WindowColor | null): void;
  close(): void;
}

/** Whether the window color picker is open, for a new window or an existing one. */
export const useWindowColorRequest = create<WindowColorState>((set) => ({
  request: null,
  preview: null,
  ask: (request) => set({ request, preview: null }),
  setPreview: (preview) => set({ preview }),
  close: () => set({ request: null, preview: null }),
}));

const anchors = new Set<HTMLElement>();

/** The window menu's trigger registers here, so the picker can open beside it. */
export function registerWindowColorAnchor(element: HTMLElement | null): () => void {
  if (!element) return () => undefined;
  anchors.add(element);
  return () => void anchors.delete(element);
}

/** A trigger that is on screen now; null when the window menu is hidden. */
export function visibleWindowColorAnchor(): HTMLElement | null {
  return [...anchors].find((element) => element.getClientRects().length > 0) ?? null;
}

/**
 * A new window needs a color first: the picker beside the window menu creates it once one
 * is chosen. With no window menu on screen, the window gets an unused color right away.
 */
export function requestNewWindow(created: () => void) {
  if (visibleWindowColorAnchor()) {
    useWindowColorRequest.getState().ask({ kind: "create" });
    return;
  }
  useWorkspaceStore.getState().createWindow();
  created();
}
