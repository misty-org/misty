import { Smile, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useMyPresence, useStatusStore, type ChosenStatus } from "@/features/direct";
import { useDoNotDisturb } from "@/shared/lib/do_not_disturb";
import { reactionPicker } from "@/shared/lib/reaction_picker";
import {
  Button,
  Dialog,
  type MemberPresence,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Emoji,
  Field,
  IconButton,
  Input,
  Label,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  notify,
  OptionSelect,
  PresenceDot,
} from "@misty/ui";

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

export function useMyCustomStatus(): string {
  return useStatusStore((state) =>
    [state.mine.custom_emoji, state.mine.custom_text].filter(Boolean).join(" "),
  );
}

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
      {props.open ? <CustomStatusForm onClose={() => props.onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function CustomStatusForm(props: { onClose(): void }) {
  const [emoji, setEmoji] = useState(() => useStatusStore.getState().mine.custom_emoji ?? "");
  const [text, setText] = useState(() => useStatusStore.getState().mine.custom_text ?? "");
  const [expiry, setExpiry] = useState("never");
  const [saving, setSaving] = useState(false);
  const textId = useId();
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
          <div className="grid gap-1.5">
            <Label htmlFor={textId}>Status</Label>
            <div className="flex items-center gap-2">
              <StatusEmojiButton emoji={emoji.trim()} onSelect={setEmoji} />
              <Input
                id={textId}
                className="min-w-0 flex-1"
                value={text}
                maxLength={128}
                placeholder="What's happening?"
                onChange={(event) => setText(event.target.value)}
              />
            </div>
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

function StatusEmojiButton(props: { emoji: string; onSelect(emoji: string): void }) {
  const Picker = reactionPicker();
  const button = (
    <IconButton label={props.emoji ? "Change emoji" : "Choose emoji"} disabled={!Picker}>
      {props.emoji ? <Emoji emoji={props.emoji} /> : <Smile />}
    </IconButton>
  );
  return Picker ? <Picker onSelect={props.onSelect}>{button}</Picker> : button;
}

export function useMyShownPresence(): MemberPresence {
  const presence = useMyPresence();
  const chosen = useStatusStore((state) => state.mine.chosen);
  return chosen === "invisible" ? "invisible" : presence;
}

export function useStatusMirror() {
  useDoNotDisturbMirror();
}

export function StatusSubmenu(props: { onCustomStatus(): void }) {
  const mine = useStatusStore((state) => state.mine);
  const presence = useMyPresence();
  const shown = useMyShownPresence();
  const custom = useMyCustomStatus();
  return (
    <MenuSubmenu icon={<PresenceDot presence={shown} />} label={presenceLabel[shown]}>
      <MenuRadioGroup
        value={presence === "idle" ? "online" : mine.chosen}
        onValueChange={(value) => {
          const chosen = choices.find((choice) => choice.value === value)?.value;
          if (chosen && chosen !== mine.chosen)
            void save({ ...useStatusStore.getState().mine, chosen });
        }}
      >
        {choices.map((choice) => (
          <MenuRadioItem
            key={choice.value}
            value={choice.value}
            icon={<PresenceDot presence={choice.value} />}
            label={choice.label}
          />
        ))}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem
        icon={Smile}
        label={custom ? "Edit custom status" : "Set custom status"}
        onSelect={() => window.setTimeout(props.onCustomStatus, 0)}
      />
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
    </MenuSubmenu>
  );
}

const presenceLabel: Record<MemberPresence, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  invisible: "Invisible",
  offline: "Offline",
  working: "Working",
  waiting: "Waiting",
};

export { CustomStatusDialog };
