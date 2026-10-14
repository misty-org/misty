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
              You will immediately lose access. Another member must invite you to regain it.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              This removes member access immediately and schedules permanent deletion. Type the
              Space name exactly to continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
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

function DangerError({ message }: { message: string }) {
  return (
    <SystemErrorNotice
      error={message}
      scope="spaces:settings:danger"
      title="Space action could not be completed"
    />
  );
}
