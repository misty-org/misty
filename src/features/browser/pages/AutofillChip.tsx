import { autofillApi } from "../autofill/api";
import { useAutofillChipStore } from "../autofill/chip";
import { fieldMenuTakesClicks } from "../webviews/pageFieldMenu";
import { Button } from "@/shared/ui";
import { setBrowserError } from "./browserErrors";
import { PageFieldNotice } from "./PageFieldNotice";

/**
 * Says something saved can fill this form, in Misty's interface and never in the page. A click
 * opens the list (`AutofillChooser`); a page has no way to open it, or to see this.
 */
export function AutofillChip(props: { tabId: string; runtimeId: string; active: boolean }) {
  const chip = useAutofillChipStore((state) => state.menus[props.runtimeId]);
  if (!chip?.kind || !props.active) return null;
  const kind = chip.kind;
  const label = kind === "card" ? "Fill card" : "Fill address";
  const open = () => {
    if (!fieldMenuTakesClicks(chip)) return;
    const { hold, close } = useAutofillChipStore.getState();
    hold(null);
    close(chip.id);
    void autofillApi
      .open(chip.id, kind, chip.place.left, chip.place.bottom)
      .catch((error: unknown) => setBrowserError(props.tabId, error));
  };
  return (
    <PageFieldNotice tabId={props.tabId} menu={chip} store={useAutofillChipStore} label={label}>
      <Button role="option" aria-selected={false} variant="ghost" size="xs" onClick={open}>
        {label}
      </Button>
    </PageFieldNotice>
  );
}
