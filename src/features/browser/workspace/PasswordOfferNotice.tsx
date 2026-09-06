import { useState } from "react";
import { passwordsApi, siteLabel } from "@/features/passwords/api";
import { usePasswordOfferStore } from "@/features/passwords/offers";
import { Button, Notification } from "@/shared/ui";

/** Asks whether to save the sign-in this page just submitted. */
export function PasswordOfferNotice(props: { runtimeId: string; active: boolean }) {
  const offer = usePasswordOfferStore((state) => state.offers[props.runtimeId]);
  const [error, setError] = useState<string | null>(null);
  if (!offer) return null;
  const respond = (save: boolean) => {
    usePasswordOfferStore.getState().dismiss(offer.id);
    void passwordsApi.respondToOffer(offer.id, save).catch((reason: unknown) => {
      if (save) setError(String(reason));
    });
  };
  const site = siteLabel(offer.origin);
  return (
    <Notification
      key={`${offer.origin}:${offer.username}`}
      title={offer.update ? "Update password?" : "Save password?"}
      active={props.active}
      onDismiss={() => respond(false)}
    >
      <p>
        {offer.update
          ? `Update the saved password for ${offer.username || site}?`
          : `Save ${offer.username ? `the password for ${offer.username}` : "this password"} on ${site}? It's encrypted with your sync vault.`}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" size="xs" onClick={() => respond(false)}>
          Not now
        </Button>
        <Button variant="secondary" size="xs" onClick={() => respond(true)}>
          {offer.update ? "Update" : "Save"}
        </Button>
      </div>
    </Notification>
  );
}
