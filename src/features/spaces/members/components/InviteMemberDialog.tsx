import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import type { MemberDialogsState } from "./useMemberDialogs";

export function InviteMemberDialog({
  dialogs,
  spaceName,
}: {
  dialogs: MemberDialogsState;
  spaceName: string;
}) {
  return (
    <Dialog
      open={dialogs.inviteOpen}
      onOpenChange={(open) => (open ? dialogs.setInviteOpen(true) : dialogs.closeInvite())}
    >
      <DialogContent className="max-w-sm">
        {dialogs.invitedLink ? (
          <InvitationLink
            email={dialogs.invitedLink.email}
            link={dialogs.invitedLink.link}
            onDone={dialogs.closeInvite}
          />
        ) : (
          <form onSubmit={(event) => void dialogs.submitInvite(event)}>
            <DialogHeader>
              <DialogTitle>Invite to {spaceName}</DialogTitle>
              <DialogDescription>
                Anyone can be invited by email. You get a link to send them; they can create an
                account or sign in before joining. The invitation expires after seven days.
              </DialogDescription>
            </DialogHeader>
            <label className="mt-5 grid gap-2 text-xs font-medium text-cream-muted">
              Email address
              <Input
                autoFocus
                type="email"
                autoComplete="email"
                placeholder="teammate@example.com"
                value={dialogs.inviteEmail}
                onChange={(event) => dialogs.setInviteEmail(event.target.value)}
              />
            </label>
            <DialogFooter className="mt-5">
              <Button
                variant="outline"
                type="button"
                disabled={dialogs.inviting}
                onClick={dialogs.closeInvite}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={dialogs.inviting || !dialogs.inviteEmail.trim()}>
                Invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The link right after inviting: Misty sends no email, so the owner passes it on. */
function InvitationLink(props: { email: string; link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(props.link)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Send this link to {props.email}</DialogTitle>
        <DialogDescription>
          It opens the invitation in Misty, for the invited email only, and expires after seven
          days. Misty doesn&apos;t send email, so share it however you like.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 flex gap-2">
        <Input
          readOnly
          aria-label="Invitation link"
          value={props.link}
          className="min-w-0 flex-1 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <DialogFooter className="mt-5">
        <Button type="button" onClick={props.onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
