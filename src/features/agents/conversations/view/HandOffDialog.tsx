import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorNotification,
  Field,
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
  const [members, setMembers] = useState<Member[]>();
  const [to, setTo] = useState("");
  const [text, setText] = useState(() => props.draft.trim().slice(0, maxLength));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shortened = props.draft.trim().length > maxLength;

  useEffect(() => {
    let live = true;
    void spacesGateway
      .get()
      .otherMembers(space.id)
      .then((found) => {
        if (!live) return;
        setMembers(found);
        setTo((current) => current || (found.length === 1 ? found[0].userId : ""));
      })
      .catch(() => {
        if (!live) return;
        setMembers([]);
        setError("Couldn't load the people in this Space. Close this and try again.");
      });
    return () => {
      live = false;
    };
  }, [space.id]);

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
                options={members.map((member) => ({ value: member.userId, label: member.name }))}
                onValueChange={setTo}
              />
            ) : (
              <Skeleton className="h-9 w-full rounded-md" />
            )}
          </Field>
          <Field
            label="Your message"
            hint={shortened ? "The reply was shortened to fit one message." : undefined}
          >
            <Textarea
              value={text}
              rows={8}
              maxLength={maxLength}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <ErrorNotification message={error} onDismiss={() => setError("")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !members?.length} onClick={() => void send()}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
