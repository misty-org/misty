import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { SpacePerson } from "../api/dto/entities";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { Avatar, AvatarFallback, Checkbox, IconButton, Input, ListRow, Text, cn } from "@misty/ui";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initials(label: string) {
  const words = label
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function PersonAvatar({ label }: { label: string }) {
  return (
    <Avatar className="size-6">
      <AvatarFallback className={cn("text-3xs", avatarColorClass(label), avatarInkClass)}>
        {initials(label)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * People the person already shares a Space with are rows to tick; anyone else is added by email
 * and listed as a row with its own remove button.
 */
export function CreateSpaceInvitePeople({
  people,
  invites,
  disabled,
  onChange,
}: {
  people: SpacePerson[];
  /** Lower-cased emails, in the order they were added. */
  invites: string[];
  disabled: boolean;
  onChange: (invites: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const known = new Set(people.map((person) => person.email.toLowerCase()));
  const extra = invites.filter((email) => !known.has(email));
  const toggle = (email: string) =>
    onChange(
      invites.includes(email) ? invites.filter((item) => item !== email) : [...invites, email],
    );
  const draftEmail = draft.trim().toLowerCase();
  const draftValid = emailPattern.test(draftEmail);
  const add = () => {
    if (!draftValid) return;
    if (!invites.includes(draftEmail)) onChange([...invites, draftEmail]);
    setDraft("");
  };

  return (
    <Text bare as="div" tone="muted" className="grid gap-2 text-xs font-medium">
      <span id="create-space-invite-label">Invite people</span>
      {people.length || extra.length ? (
        <ul className="m-0 grid list-none p-0" aria-labelledby="create-space-invite-label">
          {people.map((person) => {
            const email = person.email.toLowerCase();
            const label = person.name || person.email;
            return (
              <li key={person.user_id}>
                <ListRow
                  label={label}
                  description={person.name ? person.email : undefined}
                  leading={<PersonAvatar label={label} />}
                  trailing={
                    <Checkbox
                      aria-label={`Invite ${label}`}
                      checked={invites.includes(email)}
                      disabled={disabled}
                      onCheckedChange={() => toggle(email)}
                    />
                  }
                  onOpen={disabled ? undefined : () => toggle(email)}
                />
              </li>
            );
          })}
          {extra.map((email) => (
            <li key={email}>
              <ListRow
                label={email}
                leading={<PersonAvatar label={email} />}
                trailing={
                  <IconButton
                    size="sm"
                    label={`Remove ${email}`}
                    disabled={disabled}
                    onClick={() => toggle(email)}
                  >
                    <X />
                  </IconButton>
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-1.5">
        <Input
          type="email"
          value={draft}
          placeholder="Add by email"
          aria-label="Add by email"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds the address; it never submits the dialog from here.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add();
          }}
        />
        <IconButton
          type="button"
          variant="secondary"
          label="Add"
          disabled={disabled || !draftValid}
          onClick={add}
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </div>
      <span className="font-normal">Invitations send once the Space exists.</span>
    </Text>
  );
}
