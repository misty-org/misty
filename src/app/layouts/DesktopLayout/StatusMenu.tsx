import { Smile, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMyPresence, useStatusStore, type ChosenStatus } from "@/features/direct";
import { useDoNotDisturb } from "@/shared/lib/doNotDisturb";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  notify,
  OptionSelect,
} from "@misty/ui";

/** Idle is worked out from this computer, so only these are chosen. */
const choices: { value: ChosenStatus["chosen"]; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "dnd", label: "Do not disturb" },
  { value: "invisible", label: "Invisible" },
];

const expiries = [
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "today", label: "Today" },
  { value: "never", label: "Don't clear" },
];

/** When a custom status set now clears itself: an ISO time, or null for never. */
function expiresAt(choice: string): string | null {
  const now = new Date();
  const minutes = { "30m": 30, "1h": 60, "4h": 240 }[choice];
  if (minutes) return new Date(now.getTime() + minutes * 60_000).toISOString();
  if (choice === "today") {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
  return null;
}

const failed = () =>
  notify({ message: "Your status couldn't be changed. Try again.", tone: "error" });

function save(next: ChosenStatus) {
  return useStatusStore
    .getState()
    .setMine(next)
    .then(() => true)
    .catch(() => {
      failed();
      return false;
    });
}

/** The person's custom status as one line: its emoji and its text. */
export function useMyCustomStatus(): string {
  return useStatusStore((state) =>
    [state.mine.custom_emoji, state.mine.custom_text].filter(Boolean).join(" "),
  );
}

/**
 * Keeps this device's Do not disturb (which silences Misty's system notices) in step with the
 * status the account shows, as it loads and as it changes.
 */
function useDoNotDisturbMirror() {
  useEffect(
    () =>
      useStatusStore.subscribe((state, previous) => {
        if (state.mine === previous.mine) return;
        const dnd = state.mine.chosen === "dnd";
        if (useDoNotDisturb.getState().value !== dnd) useDoNotDisturb.getState().set(dnd);
      }),
    [],
  );
}

function CustomStatusDialog(props: { open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* The form mounts as the dialog opens, so it starts from the status as it is then. */}
      {props.open ? <CustomStatusForm onClose={() => props.onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function CustomStatusForm(props: { onClose(): void }) {
  const [emoji, setEmoji] = useState(() => useStatusStore.getState().mine.custom_emoji ?? "");
  const [text, setText] = useState(() => useStatusStore.getState().mine.custom_text ?? "");
  const [expiry, setExpiry] = useState("never");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    const done = await save({
      ...useStatusStore.getState().mine,
      custom_emoji: emoji.trim() || undefined,
      custom_text: text.trim() || undefined,
      custom_expires_at: emoji.trim() || text.trim() ? expiresAt(expiry) : null,
    });
    setSaving(false);
    if (done) props.onClose();
  };
  return (
    <DialogContent size="sm">
      <DialogHeader>
        <DialogTitle>Set custom status</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <form
          id="custom-status"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-end gap-2">
            <Field label="Emoji" className="w-16">
              <Input value={emoji} maxLength={8} onChange={(event) => setEmoji(event.target.value)} />
            </Field>
            <Field label="Status" className="min-w-0 flex-1">
              <Input
                value={text}
                maxLength={128}
                placeholder="What's happening?"
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Clear after">
            <OptionSelect value={expiry} options={expiries} onValueChange={setExpiry} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button size="lg" variant="quiet" onClick={props.onClose}>
          Cancel
        </Button>
        <Button size="lg" variant="primary" type="submit" form="custom-status" disabled={saving}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * The person's status, from the profile row: Online, Do not disturb or Invisible (Idle comes by
 * itself after a while without use), then their custom status line.
 */
export function StatusMenu() {
  useDoNotDisturbMirror();
  const mine = useStatusStore((state) => state.mine);
  const presence = useMyPresence();
  const custom = useMyCustomStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const later = (run: () => void) => () => window.setTimeout(run, 0);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton label="Status">
            <Smile />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          <MenuRadioGroup
            value={presence === "idle" ? "online" : mine.chosen}
            onValueChange={(value) => {
              const chosen = choices.find((choice) => choice.value === value)?.value;
              if (chosen && chosen !== mine.chosen)
                void save({ ...useStatusStore.getState().mine, chosen });
            }}
          >
            {choices.map((choice) => (
              <MenuRadioItem key={choice.value} value={choice.value} label={choice.label} />
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem icon={Smile} label="Set custom status" onSelect={later(() => setDialogOpen(true))} />
          {custom ? (
            <MenuItem
              icon={X}
              label="Clear custom status"
              onSelect={() =>
                void save({
                  ...useStatusStore.getState().mine,
                  custom_emoji: undefined,
                  custom_text: undefined,
                  custom_expires_at: null,
                })
              }
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomStatusDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
