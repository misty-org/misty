import { SystemErrorNotice } from "@/features/support/systemErrors";
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
} from "@/shared/ui";
import type { SpaceSettingsController } from "./useSpaceSettingsController";

/* Confirmation dialogs for leaving and deleting a Space; both share the store error. */
export function SpaceSettingsDangerDialogs({
  spaceName,
  controller,
}: {
  spaceName: string;
  controller: SpaceSettingsController;
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
          <WhatGoes leaving />
          <p className="m-0 text-sm text-cream-muted">
            Your public notes, drawings and files stay with the Space. Another member must invite
            you to come back.
          </p>
          {error ? <DangerError message={error} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dangerBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={dangerBusy}
              onClick={(event) => {
                event.preventDefault();
                void submitLeave();
              }}
            >
              {dangerBusy ? "Leaving…" : "Leave Space"}
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
            <AlertDialogTitle className="text-cream-bright">Delete {spaceName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone loses access now. For every member, this deletes at once:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <WhatGoes />
          <p className="m-0 text-sm text-cream-muted">
            The rest of the Space is deleted permanently after 30 days. Type the Space name exactly
            to continue.
          </p>
          <label className="grid gap-2 text-xs font-medium text-cream-muted">
            Space name
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
              disabled={dangerBusy || deleteConfirmation !== spaceName}
              onClick={(event) => {
                event.preventDefault();
                void submitDelete();
              }}
            >
              {dangerBusy ? "Deleting…" : "Delete Space"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** What leaving or deleting a Space takes with it: each person's private layer there. */
function WhatGoes({ leaving = false }: { leaving?: boolean }) {
  return (
    <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-cream">
      <li>Memory from this Space</li>
      <li>Private notes, drawings and files</li>
      {leaving && <li>Your code projects linked here</li>}
      <li>The app accounts picked for this Space</li>
    </ul>
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
