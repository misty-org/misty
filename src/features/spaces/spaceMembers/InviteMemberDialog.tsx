import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/ui";
import type { MemberDialogsState } from "./useMemberDialogs";

export function InviteMemberDialog({
  dialogs,
  spaceName,
  error,
}: {
  dialogs: MemberDialogsState;
  spaceName: string;
  error: string;
}) {
  return (
    <Dialog
      open={dialogs.inviteOpen}
      onOpenChange={(open) => (open ? dialogs.setInviteOpen(true) : dialogs.closeInvite())}
    >
      <DialogContent className="max-w-sm">
        <form onSubmit={(event) => void dialogs.submitInvite(event)}>
          <DialogHeader>
            <DialogTitle>Invite to {spaceName}</DialogTitle>
            <DialogDescription>
              Anyone can be invited by email. They can create an account or sign in before joining.
              The invitation expires after seven days.
            </DialogDescription>
          </DialogHeader>
          <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
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
          {error ? (
            <p
              className="mb-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
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
              {dialogs.inviting ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
