import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  FieldError,
  Input,
  cn,
} from "@/shared/ui";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { spaceInitials } from "../components/SpaceAvatar";
import { CreateSpaceInvitePeople } from "./CreateSpaceInvitePeople";
import type { useCreateSpaceDialog } from "./useCreateSpaceDialog";

/** One short form: the Space's name and who to invite. */
export function CreateSpaceDialog({ dialog }: { dialog: ReturnType<typeof useCreateSpaceDialog> }) {
  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => (open ? dialog.setOpen(true) : dialog.close())}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[440px] gap-0 p-0">
        <form className="contents" onSubmit={(event) => void dialog.submit(event)}>
          <header className="px-6 pb-4 pt-5">
            <DialogTitle className="text-lg">Create a Space</DialogTitle>
          </header>

          <div className="grid gap-5 border-t border-charcoal-border px-6 py-4">
            <label className="grid gap-2 text-xs font-medium text-cream-muted">
              Name
              <span className="flex items-center gap-3">
                <Avatar shape="tile" className="size-10 shrink-0" aria-hidden="true">
                  <AvatarFallback
                    className={cn(avatarColorClass(dialog.name || "new-space"), avatarInkClass)}
                  >
                    {spaceInitials(dialog.name)}
                  </AvatarFallback>
                </Avatar>
                <Input
                  autoFocus
                  value={dialog.name}
                  maxLength={80}
                  placeholder="Design team"
                  disabled={dialog.creating}
                  onChange={(event) => dialog.setName(event.target.value)}
                />
              </span>
            </label>

            <CreateSpaceInvitePeople
              people={dialog.people}
              invites={dialog.invites}
              disabled={dialog.creating}
              onChange={dialog.setInvites}
            />
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-charcoal-border px-6 py-3">
            <FieldError className="mr-auto min-w-0" message={dialog.createError} />
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={dialog.creating}
              onClick={dialog.close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              loading={dialog.creating}
              disabled={!dialog.name.trim()}
            >
              Create Space
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
