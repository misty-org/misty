import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { PasswordOffer } from "./api";

/** Sign-ins pages just submitted, waiting for the person to save or skip, by page. */
export const usePasswordOfferStore = create<{
  offers: Record<string, PasswordOffer>;
  dismiss(id: string): void;
}>((set) => ({
  offers: {},
  dismiss: (id) =>
    set((state) => {
      const offers = { ...state.offers };
      delete offers[id];
      return { offers };
    }),
}));

/** The native side reports the site and username only; the password stays native. */
export function listenForPasswordOffers(): () => void {
  if (!hasTauriInternals()) return () => {};
  const stop = listen<PasswordOffer>("misty://browser-password-offer", ({ payload }) => {
    if (!payload || typeof payload.id !== "string" || typeof payload.origin !== "string") return;
    usePasswordOfferStore.setState((state) => ({
      offers: { ...state.offers, [payload.id]: payload },
    }));
  });
  return () => void stop.then((unlisten) => unlisten());
}
