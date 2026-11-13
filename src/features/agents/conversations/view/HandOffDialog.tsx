import { useEffect, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { readApiAccountId } from "@/api/client/session";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  OptionSelect,
  Skeleton,
  Textarea,
} from "@/shared/ui";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";

// A Space chat message holds 3000 characters; the handoff mark takes the first few.
const maxLength = 2980;

type Member = { userId: string; name: string };

/**
 * Hands an agent's reply to another member of the Space. The reply is only a draft here: the
 * person picks who, edits the words, and sends them as their own message. Nothing leaves this
 * computer until they press Send.
 */
export function HandOffDialog(props: {
  space: { id: string; name: string };
  draft: string;
  onClose: () => void;
}) {
  const { space } = props;
  // The Space's other members from the last time, while they are read again: account data, kept
  // with the account's cache. The key names the account, since "other members" differs for each
  // person signed in on this computer. A first read that fails leaves an empty list and says so.
  const people = useCachedResource<Member[]>(
    `spaces/handoff-members:${readApiAccountId()}:${space.id}`,
    () => spacesGateway.get().otherMembers(space.id),
    { persist: "account" },
  );
  const members = people.data ?? (people.loading ? undefined : []);
  const loadError =
    people.error && !people.data
      ? "Couldn't load the people in this Space. Close this and try again."
      : "";
  const [to, setTo] = useState("");
  const [text, setText] = useState(() => props.draft.trim().slice(0, maxLength));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shortened = props.draft.trim().length > maxLength;

  // With one other member, the handoff goes to them.
  const only = people.data?.length === 1 ? people.data[0].userId : "";
  useEffect(() => {
    if (only) setTo((current) => current || only);
  }, [only]);

  const send = async () => {
    if (!to) return setError("Choose who to hand this to.");
    if (!text.trim()) return setError("Write what you're handing off first.");
    setBusy(true);
    setError("");
    try {
      await spacesGateway.get().sendHandoff(space.id, to, text);
      props.onClose();
    } catch {
      setError("The handoff couldn't be sent. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand off in {space.name || "this Space"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="To">
            {members ? (
              <OptionSelect
                aria-label="To"
                value={to}
                placeholder="Choose a member"
                disabled={!members.length}
                // People are told apart by name: no icon repeated down the list.
                options={members.map((member) => ({ value: member.userId, label: member.name }))}
                onValueChange={setTo}
              />
            ) : (
              <Skeleton className="h-8 w-full rounded-md" />
            )}
          </Field>
          <Field label={shortened ? "Your message, shortened to fit" : "Your message"}>
            <Textarea
              value={text}
              rows={8}
              maxLength={maxLength}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <FieldError message={error || loadError} />
        </div>
        <DialogFooter>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button disabled={busy || !members?.length} onClick={() => void send()}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
