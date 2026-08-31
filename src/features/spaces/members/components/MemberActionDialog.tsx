import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui";
import type { MemberDialogsState } from "./useMemberDialogs";

/** Confirms the two destructive member actions: transfer ownership and remove. */
export function MemberActionDialog({ dialogs }: { dialogs: MemberDialogsState }) {
  const { memberAction, actionBusy } = dialogs;
  const isTransfer = memberAction?.kind === "transfer";

  return (
    <AlertDialog
      open={Boolean(memberAction)}
      onOpenChange={(open) => !open && !actionBusy && dialogs.setMemberAction(undefined)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isTransfer ? "Transfer Space ownership?" : "Remove this member?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isTransfer
              ? `${memberAction.member.name} will become the owner and control membership and Space settings.`
              : `${memberAction?.member.name ?? "This member"} will immediately lose access to this Space.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              memberAction?.kind === "remove"
                ? "bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
                : ""
            }
            disabled={actionBusy}
            onClick={(event) => {
              event.preventDefault();
              void dialogs.confirmMemberAction();
            }}
          >
            {actionBusy ? "Working…" : isTransfer ? "Transfer ownership" : "Remove member"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
