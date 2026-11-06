import { useState } from "react";
import { autofillApi, type AutofillOffer } from "@/features/autofill/api";
import { useAutofillOfferStore } from "@/features/autofill/offers";
import { Button, ErrorNotification, Notification } from "@/shared/ui";

function offerTitle(offer: AutofillOffer): string {
  const verb = offer.update ? "Update" : "Save";
  if (offer.address && offer.card) return `${verb} address and card?`;
  return `${verb} ${offer.card ? "card" : "address"}?`;
}

/** Asks whether to save the address or card this page's form just submitted. */
export function AutofillOfferNotice(props: { runtimeId: string; active: boolean }) {
  const offer = useAutofillOfferStore((state) => state.offers[props.runtimeId]);
  const [error, setError] = useState<string | null>(null);
  const failure = <ErrorNotification message={error} onDismiss={() => setError(null)} />;
  if (!offer) return failure;
  const respond = (save: boolean) => {
    useAutofillOfferStore.getState().dismiss(offer.id);
    void autofillApi.respondToOffer(offer.id, save).catch((reason: unknown) => {
      if (save) setError(String(reason));
    });
  };
  return (
    <>
      <Notification
        key={`${offer.address}:${offer.card}`}
        title={offerTitle(offer)}
        active={props.active}
        onDismiss={() => respond(false)}
      >
        <p data-private="true" className="ph-no-capture">
          {[offer.address, offer.card].filter(Boolean).join(" and ")}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="xs" onClick={() => respond(false)}>
            Not now
          </Button>
          <Button variant="secondary" size="xs" onClick={() => respond(true)}>
            {offer.update ? "Update" : "Save"}
          </Button>
        </div>
      </Notification>
      {failure}
    </>
  );
}
