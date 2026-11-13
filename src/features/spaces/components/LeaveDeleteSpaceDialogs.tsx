import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Text,
} from "@/shared/ui";
import type { SpaceLifecycleActions } from "./useSpaceLifecycleActions";

/* Confirmation dialogs for leaving and deleting a Space; both share the store error. */
export function LeaveDeleteSpaceDialogs({
  spaceName,
  controller,
}: {
  spaceName: string;
  controller: SpaceLifecycleActions;
}) {
  const {
    error,
    leaveOpen,
    setLeaveOpen,
    deleteOpen,
    setDeleteOpen,
    deleteConfirmation,
    setDeleteConfirmation,
    dangerBusy,
    submitLeave,
    submitDelete,
  } = controller;
  return (
    <>
      <AlertDialog
        open={leaveOpen}
        onOpenChange={(open) => !open && !dangerBusy && setLeaveOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {spaceName}?</AlertDialogTitle>
            <AlertDialogDescription>
              You lose access now, and everything of yours in this Space is deleted with you:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <WhatGoes />
          <Text tone="muted" wrap className="m-0 text-sm">
            Your public docs, drawings and files stay with the Space. Another member must invite you
            to come back.
          </Text>
          {error ? <DangerError message={error} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dangerBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              loading={dangerBusy}
              onClick={(event) => {
                event.preventDefault();
                void submitLeave();
              }}
            >
              Leave Space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !dangerBusy) {
            setDeleteOpen(false);
            setDeleteConfirmation("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {spaceName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone loses access now. For every member, this deletes at once:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <WhatGoes />
          <Text tone="muted" wrap className="m-0 text-sm">
            The rest of the Space is deleted permanently after 30 days. Type the Space name exactly
            to continue.
          </Text>
          <label className="grid gap-2 text-xs font-medium">
            <Text bare tone="muted">
              Space name
            </Text>
            <Input
              autoFocus
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </label>
          {error ? <DangerError message={error} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dangerBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmation !== spaceName}
              loading={dangerBusy}
              onClick={(event) => {
                event.preventDefault();
                void submitDelete();
              }}
            >
              Delete Space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** What leaving or deleting a Space takes with it: each person's private layer there. */
function WhatGoes() {
  return (
    <Text bare as="div" tone="default">
      <ul className="m-0 list-disc space-y-1 pl-5 text-sm">
        <li>Agent conversations in this Space</li>
        <li>Private docs, drawings and files</li>
        <li>The app accounts picked for this Space</li>
      </ul>
    </Text>
  );
}

function DangerError({ message }: { message: string }) {
  return (
    <SystemErrorNotice
      error={message}
      scope="spaces:settings:danger"
      title="Space action could not be completed"
    />
  );
}
