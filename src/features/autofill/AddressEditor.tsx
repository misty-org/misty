import { useState } from "react";
import { Button, ErrorNotification, Input, Textarea } from "@/shared/ui";
import { autofillApi, emptyAddress, type SavedAddress } from "./api";

type TextField = Exclude<keyof SavedAddress, "id" | "street">;

const fields: { key: TextField; label: string; type?: string }[] = [
  { key: "name", label: "Full name" },
  { key: "organization", label: "Company" },
  { key: "city", label: "City" },
  { key: "region", label: "State or province" },
  { key: "postalCode", label: "Postal code" },
  { key: "country", label: "Country" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
];

/** Adds an address, or changes a saved one. */
export function AddressEditor(props: {
  address: SavedAddress | null;
  onDone(saved: boolean): void;
}) {
  const [address, setAddress] = useState<SavedAddress>(props.address ?? emptyAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await autofillApi.saveAddress(address);
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
      <Textarea
        aria-label="Street address"
        placeholder="Street address"
        rows={2}
        autoComplete="off"
        value={address.street}
        disabled={busy}
        onChange={(event) => setAddress({ ...address, street: event.target.value })}
      />
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <Input
            key={field.key}
            aria-label={field.label}
            placeholder={field.label}
            type={field.type ?? "text"}
            autoComplete="off"
            value={address[field.key]}
            disabled={busy}
            onChange={(event) => setAddress({ ...address, [field.key]: event.target.value })}
          />
        ))}
      </div>
      <ErrorNotification message={error} onDismiss={() => setError(null)} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => props.onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {props.address ? "Save changes" : "Add address"}
        </Button>
      </div>
    </form>
  );
}
