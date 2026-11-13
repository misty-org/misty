import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Text,
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
              <DialogDescription>The invitation expires after seven days.</DialogDescription>
            </DialogHeader>
            <Text bare as="label" tone="muted" className="mt-5 grid gap-2 text-xs font-medium">
              Email address
              <Input
                autoFocus
                type="email"
                autoComplete="email"
                placeholder="teammate@example.com"
                value={dialogs.inviteEmail}
                onChange={(event) => dialogs.setInviteEmail(event.target.value)}
              />
            </Text>
            <DialogFooter className="mt-5">
              <Button
                variant="secondary"
                size="lg"
                type="button"
                disabled={dialogs.inviting}
                onClick={dialogs.closeInvite}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="lg"
                disabled={dialogs.inviting || !dialogs.inviteEmail.trim()}
              >
                Invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The link right after inviting, for the owner to pass on. A server with Mailjet also emails it. */
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
        <DialogTitle>Invitation for {props.email}</DialogTitle>
        <DialogDescription>Share this link with them. It expires in seven days.</DialogDescription>
      </DialogHeader>
      <div className="mt-5 flex gap-2">
        <Input
          readOnly
          aria-label="Invitation link"
          value={props.link}
          className="min-w-0 flex-1"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" variant="secondary" icon={copied ? Check : Copy} onClick={copy}>
          Copy
        </Button>
      </div>
      <DialogFooter className="mt-5">
        <Button type="button" size="lg" onClick={props.onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
