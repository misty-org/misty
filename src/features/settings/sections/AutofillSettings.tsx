import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AddressEditor } from "@/features/autofill/AddressEditor";
import { autofillApi, type SavedAddress, type SavedCard } from "@/features/autofill/api";
import { CardEditor } from "@/features/autofill/CardEditor";
import { formatCardExpiry } from "@/features/autofill/cardInput";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SettingsNote, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

function addressTitle(address: SavedAddress): string {
  return (
    [address.street.split("\n")[0], address.city].filter(Boolean).join(", ") ||
    address.name ||
    address.email ||
    "Address"
  );
}

function addressDetail(address: SavedAddress): string | undefined {
  const street = address.street.split("\n")[0];
  const detail = address.name && (street || address.city) ? address.name : address.phone;
  return detail || undefined;
}

/** Whether Misty fills forms on this computer, and the addresses and cards it fills them from. */
export function AutofillSettings(props: SettingsContentProps) {
  const toggle = (key: string) => ({
    checked: booleanSetting(props.document, "autofill", key, true),
    disabled: props.working,
    onChange: (value: boolean) => props.onSettingChange("autofill", key, value),
  });
  return (
    <>
      <SettingsSectionBlock title="Autofill">
        <SettingsRow label="Fill addresses">
          <SwitchControl {...toggle("addresses_enabled")} />
        </SettingsRow>
        <SettingsRow
          label="Fill cards"
          description="Asks for Touch ID, Windows Hello or your computer's password each time."
        >
          <SwitchControl {...toggle("cards_enabled")} />
        </SettingsRow>
        <SettingsRow label="Offer to save">
          <SwitchControl {...toggle("offer_to_save")} />
        </SettingsRow>
      </SettingsSectionBlock>
      <SavedList<SavedAddress>
        title="Addresses"
        addLabel="Add address"
        empty="No saved addresses yet."
        load={autofillApi.addresses}
        keyOf={(address) => address.id ?? ""}
        titleOf={addressTitle}
        detailOf={addressDetail}
        editor={(item, onDone) => <AddressEditor address={item} onDone={onDone} />}
      />
      <SavedList<SavedCard>
        title="Cards"
        addLabel="Add card"
        empty="No saved cards yet."
        load={autofillApi.cards}
        keyOf={(card) => card.id}
        titleOf={(card) => `${card.brand} ending in ${card.last4}`}
        detailOf={(card) =>
          [card.holder, formatCardExpiry(card.expMonth, card.expYear)].filter(Boolean).join(", ")
        }
        editor={(item, onDone) => <CardEditor card={item} onDone={onDone} />}
      />
    </>
  );
}

/** One saved kind: its list, with add, edit and delete. */
function SavedList<Item>(props: {
  title: string;
  addLabel: string;
  empty: string;
  load(): Promise<Item[]>;
  keyOf(item: Item): string;
  titleOf(item: Item): string;
  detailOf(item: Item): string | undefined;
  editor(item: Item | null, onDone: (saved: boolean) => void): ReactNode;
}) {
  const { load } = props;
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: Item | null } | null>(null);
  const noun = props.title.toLocaleLowerCase();

  const refresh = useCallback(async () => {
    try {
      setItems(await load());
      setError(null);
    } catch {
      setError(`Saved ${noun} could not be loaded. Try again.`);
    }
  }, [load, noun]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (item: Item) => {
    const name = props.titleOf(item);
    if (!(await confirmAction(`Delete ${name}?`))) return;
    try {
      await autofillApi.remove(props.keyOf(item));
      void refresh();
    } catch {
      setError(`${name} could not be deleted. Try again.`);
    }
  };

  return (
    <SettingsSectionBlock title={props.title}>
      <div className="flex justify-end pb-3">
        <Button variant="outline" size="sm" onClick={() => setEditing({ item: null })}>
          {props.addLabel}
        </Button>
      </div>
      {editing
        ? props.editor(editing.item, (saved) => {
            setEditing(null);
            if (saved) void refresh();
          })
        : null}
      {error ? (
        <DesktopSettingsNotice
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        >
          {error}
        </DesktopSettingsNotice>
      ) : null}
      {items === null && !error ? (
        <SkeletonList label={props.title} rows={2} leading="none" trailing />
      ) : null}
      {items !== null && !items.length ? <SettingsNote>{props.empty}</SettingsNote> : null}
      {(items ?? []).map((item) => {
        const name = props.titleOf(item);
        const detail = props.detailOf(item);
        return (
          <SettingsRow
            key={props.keyOf(item)}
            label={name}
            description={
              detail ? (
                <span data-private="true" className="ph-no-capture">
                  {detail}
                </span>
              ) : undefined
            }
          >
            <IconButton size="xs" label={`Edit ${name}`} onClick={() => setEditing({ item })}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton size="xs" label={`Delete ${name}`} onClick={() => void remove(item)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </SettingsRow>
        );
      })}
    </SettingsSectionBlock>
  );
}
