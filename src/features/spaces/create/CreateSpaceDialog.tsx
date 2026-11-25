import {
  Avatar,
  AvatarFallback,
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
  cn,
} from "@misty/ui";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatar_palette";
import { spaceInitials } from "../components/SpaceAvatar";
import { CreateSpaceInvitePeople } from "./CreateSpaceInvitePeople";
import type { useCreateSpaceDialog } from "./use_create_space_dialog";

export function CreateSpaceDialog({ dialog }: { dialog: ReturnType<typeof useCreateSpaceDialog> }) {
  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => (open ? dialog.setOpen(true) : dialog.close())}
    >
      <DialogContent aria-describedby={undefined} size="md">
        <form className="contents" onSubmit={(event) => void dialog.submit(event)}>
          <DialogHeader>
            <DialogTitle>Create a Space</DialogTitle>
          </DialogHeader>

          <DialogBody className="grid gap-5">
            <div className="flex items-end gap-3">
              <Avatar shape="tile" className="size-12 shrink-0" aria-hidden="true">
                <AvatarFallback
                  className={cn(avatarColorClass(dialog.name || "new-space"), avatarInkClass)}
                >
                  {spaceInitials(dialog.name)}
                </AvatarFallback>
              </Avatar>
              <Field label="Name" className="min-w-0 flex-1">
                <Input
                  autoFocus
                  value={dialog.name}
                  maxLength={64}
                  placeholder="Design team"
                  disabled={dialog.creating}
                  onChange={(event) => dialog.setName(event.target.value)}
                />
              </Field>
            </div>

            <CreateSpaceInvitePeople
              people={dialog.people}
              invites={dialog.invites}
              disabled={dialog.creating}
              onChange={dialog.setInvites}
            />
          </DialogBody>

          <DialogFooter>
            <FieldError className="mr-auto min-w-0" message={dialog.createError} />
            <Button
              type="button"
              variant="quiet"
              size="lg"
              disabled={dialog.creating}
              onClick={dialog.close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={!dialog.name.trim() || dialog.creating}
            >
              Create Space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
