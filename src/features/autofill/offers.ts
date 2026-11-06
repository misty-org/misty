import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AutofillOffer } from "./api";

/** Addresses and cards pages just submitted, waiting for the person to save or skip, by page. */
export const useAutofillOfferStore = create<{
  offers: Record<string, AutofillOffer>;
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

/** The native side reports labels only; the details stay native until they're saved. */
export function listenForAutofillOffers(): () => void {
  if (!hasTauriInternals()) return () => {};
  const stop = listen<AutofillOffer>("misty://browser-autofill-offer", ({ payload }) => {
    if (!payload || typeof payload.id !== "string" || typeof payload.origin !== "string") return;
    useAutofillOfferStore.setState((state) => ({
      offers: { ...state.offers, [payload.id]: payload },
    }));
  });
  return () => void stop.then((unlisten) => unlisten());
}
