import {
  createPageFieldMenuStore,
  listenForPageFieldMenu,
  type PageFieldMenu,
} from "../webviews/pageFieldMenu";

/** The chip under a focused address or card field; no kind closes it. */
export interface AutofillChipState extends PageFieldMenu {
  kind: "address" | "card" | null;
}

export const useAutofillChipStore = createPageFieldMenuStore<AutofillChipState>();

export function listenForAutofillChips(): () => void {
  return listenForPageFieldMenu(
    "misty://browser-autofill-chip",
    useAutofillChipStore,
    (payload) => payload.kind === null,
  );
}
