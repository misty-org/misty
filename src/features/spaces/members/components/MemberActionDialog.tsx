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
              ? `${memberAction.member.name} becomes the owner.`
              : `${memberAction?.member.name ?? "This member"} loses access now. ` +
                "Their private items here are deleted; public items stay."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            loading={actionBusy}
            onClick={(event) => {
              event.preventDefault();
              void dialogs.confirmMemberAction();
            }}
          >
            {isTransfer ? "Transfer ownership" : "Remove member"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
