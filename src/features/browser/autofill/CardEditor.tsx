import { useState } from "react";
import { Button, ErrorNotification, Input } from "@/shared/ui";
import { autofillApi, type SavedCard } from "./api";
import { formatCardExpiry, formatCardNumber, parseCardExpiry } from "./cardInput";

/**
 * Adds a card, or changes a saved one. The saved number never comes back here: leaving the field
 * empty keeps it. There is no security code field because Misty never keeps one.
 */
export function CardEditor(props: { card: SavedCard | null; onDone(saved: boolean): void }) {
  const { card } = props;
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState(card?.holder ?? "");
  const [expiry, setExpiry] = useState(card ? formatCardExpiry(card.expMonth, card.expYear) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const parsed = parseCardExpiry(expiry);
    if (!parsed) {
      setError("Enter the expiry date as MM/YY.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await autofillApi.saveCard({
        id: card?.id,
        number,
        holder,
        expMonth: parsed.month,
        expYear: parsed.year,
      });
      props.onDone(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="ph-no-capture mb-3 grid gap-2 py-2"
      data-private="true"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Input
        aria-label="Card number"
        placeholder={card ? `Leave empty to keep the card ending in ${card.last4}` : "Card number"}
        inputMode="numeric"
        autoComplete="off"
        value={number}
        disabled={busy}
        onChange={(event) => setNumber(formatCardNumber(event.target.value))}
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Name on card"
          placeholder="Name on card"
          autoComplete="off"
          value={holder}
          disabled={busy}
          onChange={(event) => setHolder(event.target.value)}
        />
        <Input
          aria-label="Expiry date"
          placeholder="MM/YY"
          inputMode="numeric"
          autoComplete="off"
          value={expiry}
          disabled={busy}
          onChange={(event) => setExpiry(event.target.value)}
        />
      </div>
      <ErrorNotification message={error} onDismiss={() => setError(null)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => props.onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || (!card && !number)}>
          {card ? "Save changes" : "Add card"}
        </Button>
      </div>
    </form>
  );
}
