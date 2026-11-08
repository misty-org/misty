import { useState } from "react";
import { passwordsApi, siteLabel } from "../passwords/api";
import { usePasswordOfferStore } from "../passwords/offers";
import { Button, ErrorNotification, Notification } from "@/shared/ui";

/** Asks whether to save the sign-in this page just submitted. */
export function PasswordOfferNotice(props: { runtimeId: string; active: boolean }) {
  const offer = usePasswordOfferStore((state) => state.offers[props.runtimeId]);
  const [error, setError] = useState<string | null>(null);
  const failure = <ErrorNotification message={error} onDismiss={() => setError(null)} />;
  if (!offer) return failure;
  const respond = (save: boolean) => {
    usePasswordOfferStore.getState().dismiss(offer.id);
    void passwordsApi.respondToOffer(offer.id, save).catch((reason: unknown) => {
      if (save) setError(String(reason));
    });
  };
  return (
    <>
      <Notification
        key={`${offer.origin}:${offer.username}`}
        title={offer.update ? "Update password?" : "Save password?"}
        active={props.active}
        onDismiss={() => respond(false)}
      >
        <p>
          {offer.update ? "Update" : "Save"} {offer.username || "password"} for{" "}
          {siteLabel(offer.origin)}
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
