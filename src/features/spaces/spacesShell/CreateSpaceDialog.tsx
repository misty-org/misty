import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Spinner,
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
      <DialogContent
        aria-describedby="create-space-description"
        className="max-w-[440px] gap-0 p-0"
      >
        <form className="contents" onSubmit={(event) => void dialog.submit(event)}>
          <header className="px-6 pb-4 pt-5">
            <DialogTitle className="text-lg">Create a Space</DialogTitle>
            <DialogDescription id="create-space-description" className="mt-1">
              A shared place for people and their agents to chat and make things.
            </DialogDescription>
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
            {dialog.createError ? (
              <p role="alert" className="m-0 mr-auto text-sm text-cream">
                {dialog.createError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={dialog.creating}
              onClick={dialog.close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              aria-busy={dialog.creating}
              disabled={dialog.creating || !dialog.name.trim()}
            >
              {dialog.creating ? <Spinner size="sm" label={false} /> : null}
              Create Space
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
