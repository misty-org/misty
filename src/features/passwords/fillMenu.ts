import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface PasswordMenu {
  /** The browser page's native runtime id. */
  id: string;
  origin: string;
  logins: { id: string; username: string }[];
  /** Where the page says its field is, as fractions of the page. */
  place: { left: number; bottom: number; width: number };
  shownAt: number;
}

/**
 * A page can put the menu under the pointer the moment someone clicks, so a click this soon
 * after it appears was aimed at something else. The same wait applies wherever the page moves it.
 */
export const PASSWORD_MENU_CLICK_DELAY_MS = 500;

/** Saved sign-ins offered for a focused field, by page. */
export const usePasswordMenuStore = create<{
  menus: Record<string, PasswordMenu>;
  /** The page whose menu has the pointer; closing it would take the row from under a click. */
  held: string | null;
  closeWhenReleased: boolean;
  hold(id: string | null): void;
  close(id: string): void;
}>((set, get) => ({
  menus: {},
  held: null,
  closeWhenReleased: false,
  hold: (id) => {
    const { held, closeWhenReleased, close } = get();
    set({ held: id, closeWhenReleased: false });
    if (id === null && held !== null && closeWhenReleased) close(held);
  },
  close: (id) =>
    set((state) => {
      const menus = { ...state.menus };
      delete menus[id];
      return { menus };
    }),
}));

/** The native side sends the sign-ins here, never to the page, and an empty list to close. */
export function listenForPasswordMenus(): () => void {
  if (!hasTauriInternals()) return () => {};
  const stop = listen<Omit<PasswordMenu, "shownAt">>(
    "misty://browser-password-menu",
    ({ payload }) => {
      const store = usePasswordMenuStore.getState();
      if (payload.logins.length === 0) {
        if (store.held === payload.id) usePasswordMenuStore.setState({ closeWhenReleased: true });
        else store.close(payload.id);
        return;
      }
      usePasswordMenuStore.setState((state) => ({
        closeWhenReleased: false,
        menus: { ...state.menus, [payload.id]: { ...payload, shownAt: performance.now() } },
      }));
    },
  );
  return () => void stop.then((unlisten) => unlisten());
}
