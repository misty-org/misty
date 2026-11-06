import { listen } from "@tauri-apps/api/event";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Something Misty draws under a field in a page, such as the saved sign-ins for it. */
export interface PageFieldMenu {
  /** The browser page's native runtime id. */
  id: string;
  /** Where the page says its field is, as fractions of the page. */
  place: { left: number; bottom: number; width?: number };
  shownAt: number;
}

/**
 * A page can put one of these under the pointer the moment someone clicks, so a click this soon
 * after it appears was aimed at something else. The same wait applies wherever the page moves it.
 */
export const FIELD_MENU_CLICK_DELAY_MS = 500;

export const fieldMenuTakesClicks = (menu: PageFieldMenu) =>
  performance.now() - menu.shownAt >= FIELD_MENU_CLICK_DELAY_MS;

export interface PageFieldMenuState<M extends PageFieldMenu> {
  menus: Record<string, M>;
  /** The page whose menu has the pointer; closing it would take the row from under a click. */
  held: string | null;
  closeWhenReleased: boolean;
  hold(id: string | null): void;
  close(id: string): void;
}
export type PageFieldMenuStore<M extends PageFieldMenu> = UseBoundStore<
  StoreApi<PageFieldMenuState<M>>
>;

export function createPageFieldMenuStore<M extends PageFieldMenu>(): PageFieldMenuStore<M> {
  return create<PageFieldMenuState<M>>((set, get) => ({
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
}

/** The native side sends what to show here, never to the page, and a closing message otherwise. */
export function listenForPageFieldMenu<M extends PageFieldMenu>(
  event: string,
  store: PageFieldMenuStore<M>,
  closes: (payload: Omit<M, "shownAt">) => boolean,
): () => void {
  if (!hasTauriInternals()) return () => {};
  const stop = listen<Omit<M, "shownAt">>(event, ({ payload }) => {
    const state = store.getState();
    if (closes(payload)) {
      if (state.held === payload.id) store.setState({ closeWhenReleased: true });
      else state.close(payload.id);
      return;
    }
    store.setState((current) => ({
      closeWhenReleased: false,
      menus: { ...current.menus, [payload.id]: { ...payload, shownAt: performance.now() } as M },
    }));
  });
  return () => void stop.then((unlisten) => unlisten());
}
