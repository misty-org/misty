import { invoke } from "@tauri-apps/api/core";

/** A saved address, as Settings shows and edits it. */
export interface SavedAddress {
  /** Absent until it's saved. */
  id?: string | null;
  name: string;
  organization: string;
  /** Street lines, separated by newlines. */
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
}

/** A saved card as Settings lists it. Its number never leaves native code. */
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  holder: string;
  expMonth: number;
  expYear: number;
}

/** What a page's form just submitted, named for the person; the details stay native. */
export interface AutofillOffer {
  /** The browser page's native runtime id. */
  id: string;
  origin: string;
  address: string | null;
  card: string | null;
  /** Something here is already saved and would change. */
  update: boolean;
}

/** The person clicked Misty's fill chip: what they can pick from, and where to show it. */
export interface AutofillChoice {
  key: string;
  /** The browser page's native runtime id. */
  id: string;
  kind: "address" | "card";
  /** Where the field is, as fractions of the page. */
  x: number;
  y: number;
  items: { id: string; label: string; detail: string }[];
}

export const emptyAddress: SavedAddress = {
  name: "",
  organization: "",
  street: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  phone: "",
  email: "",
};

export const autofillApi = {
  addresses: () => invoke<SavedAddress[]>("browser_autofill_addresses_list"),
  saveAddress: (address: SavedAddress) =>
    invoke<void>("browser_autofill_address_save", { address }),
  cards: () => invoke<SavedCard[]>("browser_autofill_cards_list"),
  saveCard: (input: {
    id?: string;
    number: string;
    holder: string;
    expMonth: number;
    expYear: number;
  }) =>
    invoke<void>("browser_autofill_card_save", {
      id: input.id ?? null,
      number: input.number,
      holder: input.holder,
      expMonth: input.expMonth,
      expYear: input.expYear,
    }),
  remove: (id: string) => invoke<void>("browser_autofill_delete", { id }),
  /** Opens the list of saved details over a page, after a click on Misty's chip. */
  open: (id: string, kind: "address" | "card", left: number, bottom: number) =>
    invoke<void>("browser_autofill_open", { id, kind, left, bottom }),
  choose: (key: string, item: string | null) =>
    invoke<void>("browser_autofill_choose", { key, item }),
  respondToOffer: (id: string, save: boolean) =>
    invoke<void>("browser_autofill_offer_respond", { id, save }),
};
