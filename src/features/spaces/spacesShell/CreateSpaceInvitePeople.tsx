import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { SpacePerson } from "@/api/spaces/dto/interfaces/types";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { Avatar, AvatarFallback, Button, Input, cn } from "@/shared/ui";

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
      <AvatarFallback className={cn("text-[10px]", avatarColorClass(label), avatarInkClass)}>
        {initials(label)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * People the person already shares a Space with are one-click toggle buttons;
 * anyone else is added by email and shown as a button that removes them.
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
    <div className="grid gap-2 text-xs font-medium text-cream-muted">
      <span id="create-space-invite-label">Invite people</span>
      {people.length || extra.length ? (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-labelledby="create-space-invite-label"
        >
          {people.map((person) => {
            const email = person.email.toLowerCase();
            const picked = invites.includes(email);
            return (
              <Button
                key={person.user_id}
                type="button"
                variant="chip"
                size="sm"
                aria-pressed={picked}
                title={person.email}
                disabled={disabled}
                className="gap-1.5 pl-1 pr-2.5 font-normal"
                onClick={() => toggle(email)}
              >
                <PersonAvatar label={person.name || person.email} />
                {(person.name || person.email).split(" ")[0]}
                {picked ? <Check aria-hidden="true" className="size-3.5" /> : null}
              </Button>
            );
          })}
          {extra.map((email) => (
            <Button
              key={email}
              type="button"
              variant="chip"
              size="sm"
              aria-pressed
              aria-label={`Remove ${email}`}
              disabled={disabled}
              className="gap-1.5 pl-1 pr-2 font-normal"
              onClick={() => toggle(email)}
            >
              <PersonAvatar label={email} />
              {email}
              <X aria-hidden="true" className="size-3.5 text-cream-muted" />
            </Button>
          ))}
        </div>
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
        <Button
          type="button"
          variant="outline"
          aria-label="Add"
          disabled={disabled || !draftValid}
          onClick={add}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <span className="font-normal">Invitations send once the Space exists.</span>
    </div>
  );
}
