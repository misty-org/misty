import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from "@misty/ui";

/** The invitation's token from a pasted link (`misty://open/invite/…`, a web link to it) or the token alone. */
export function inviteToken(text: string): string {
  const trimmed = text.trim();
  const fromPath = /\/invite\/([^/?#\s]+)/.exec(trimmed)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);
  return /^[A-Za-z0-9_-]{16,}$/.test(trimmed) ? trimmed : "";
}

/**
 * Joins a Space from an invite link someone sent: a quiet button that asks for the link, then opens
 * the invitation's own page, which shows the Space and asks to join.
 */
export function JoinWithLink() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const join = () => {
    const token = inviteToken(link);
    if (!token) return setError("That isn't an invite link.");
    setOpen(false);
    setLink("");
    void navigate(`/invite/${encodeURIComponent(token)}`);
  };
  return (
    <>
      <Button variant="quiet" onClick={() => setOpen(true)}>
        Join with a link
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join with a link</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label="Invite link" error={error || undefined}>
              <Input
                autoFocus
                value={link}
                placeholder="misty://open/invite/…"
                onChange={(event) => {
                  setLink(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") join();
                }}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="quiet" size="lg" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" disabled={!link.trim()} onClick={join}>
              Join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
