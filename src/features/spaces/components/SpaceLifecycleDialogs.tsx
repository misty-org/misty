import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
  Text,
} from "@misty/ui";
import type { SpaceLifecycleActions } from "./use_space_lifecycle_actions";

export function DeleteSpaceDialog({
  spaceName,
  controller,
}: {
  spaceName: string;
  controller: SpaceLifecycleActions;
}) {
  const busy = controller.dangerBusy;
  const close = () => {
    if (busy) return;
    controller.setDeleteOpen(false);
    controller.setDeleteConfirmation("");
    controller.clearError();
  };
  return (
    <Dialog open={controller.deleteOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent size="sm">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.submitDelete();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Delete ${spaceName}?`}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Text as="p" size="control" tone="muted" wrap>
              Its channels, chats, files and agents go for everyone. This can't be undone.
            </Text>
            <Field label="Type the Space's name" error={controller.error || undefined}>
              <Input
                autoFocus
                autoComplete="off"
                value={controller.deleteConfirmation}
                onChange={(event) => controller.setDeleteConfirmation(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="quiet" size="lg" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="lg"
              disabled={busy || controller.deleteConfirmation !== spaceName}
            >
              Delete
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveSpaceDialog({
  spaceName,
  controller,
}: {
  spaceName: string;
  controller: SpaceLifecycleActions;
}) {
  const busy = controller.dangerBusy;
  const close = () => {
    if (busy) return;
    controller.setLeaveOpen(false);
    controller.clearError();
  };
  return (
    <Dialog open={controller.leaveOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{`Leave ${spaceName}?`}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-2">
          <Text as="p" size="control" tone="muted" wrap>
            Your agent chats, private notes and files in it are deleted. Someone has to invite you
            to come back.
          </Text>
          <FieldError message={controller.error || undefined} />
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="lg"
            disabled={busy}
            onClick={() => void controller.submitLeave()}
          >
            Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
