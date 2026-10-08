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
import { CreateSpaceSeedPreview } from "./CreateSpaceSeedPreview";
import {
  CreateSpaceMineTab,
  CreateSpaceTemplateGrid,
  CreateSpaceTemplateGridSkeleton,
} from "./CreateSpaceTemplateGrid";
import type { CreateSpaceTab, useCreateSpaceDialog } from "./useCreateSpaceDialog";

const tabs: [CreateSpaceTab, string][] = [
  ["templates", "Templates"],
  ["mine", "Mine"],
];

/** One screen: starting points on the left, the Space's name, invites and contents on the right. */
export function CreateSpaceDialog({ dialog }: { dialog: ReturnType<typeof useCreateSpaceDialog> }) {
  const loading = !dialog.curated;
  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => (open ? dialog.setOpen(true) : dialog.close())}
    >
      <DialogContent
        aria-describedby="create-space-description"
        className="max-w-[880px] gap-0 overflow-hidden p-0 max-[760px]:max-h-[calc(100dvh-2rem)]"
      >
        <form className="contents" onSubmit={(event) => void dialog.submit(event)}>
          <header className="px-6 pb-4 pt-5">
            <DialogTitle className="text-lg">Create a Space</DialogTitle>
            <DialogDescription id="create-space-description" className="mt-1">
              Pick a starting point. Everything can be changed later.
            </DialogDescription>
          </header>

          <div
            className={cn(
              "grid h-[min(540px,calc(100dvh-12rem))] min-h-0 grid-cols-[minmax(0,1fr)_300px]",
              "border-t border-charcoal-border max-[760px]:h-[calc(100dvh-13rem)]",
              "max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]",
            )}
          >
            <section className="min-h-0 overflow-y-auto px-6 py-4">
              <div className="mb-3 flex gap-1.5" role="group" aria-label="Start from">
                {tabs.map(([id, label]) => (
                  <Button
                    key={id}
                    type="button"
                    variant="chip"
                    size="sm"
                    aria-pressed={dialog.tab === id}
                    onClick={() => dialog.setTab(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {dialog.tab === "templates" ? (
                loading ? (
                  <CreateSpaceTemplateGridSkeleton />
                ) : (
                  <>
                    <CreateSpaceTemplateGrid
                      templates={dialog.curated ?? []}
                      selectedId={dialog.template?.id}
                      onSelect={dialog.chooseTemplate}
                    />
                    {dialog.curatedFailed ? (
                      <p className="m-0 mt-3 text-xs text-cream-muted">
                        Templates couldn't load. Blank is still available; reopen this dialog to try
                        again.
                      </p>
                    ) : null}
                  </>
                )
              ) : (
                <CreateSpaceMineTab
                  templates={dialog.personal}
                  templatesFailed={dialog.personalFailed}
                  spaces={dialog.spaces}
                  selectedId={dialog.template?.id}
                  sourceSpaceId={dialog.sourceSpace?.id}
                  onSelect={dialog.chooseTemplate}
                  onCopySpace={dialog.copySpace}
                />
              )}
            </section>

            <aside
              className={cn(
                "grid min-h-0 content-start gap-5 overflow-y-auto border-l border-charcoal-border",
                "bg-charcoal-workspace/40 px-5 py-4",
                "max-[760px]:order-first max-[760px]:border-b max-[760px]:border-l-0",
              )}
            >
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

              {/* Narrow windows keep the counts on each card instead of the full preview. */}
              <div className="max-[760px]:hidden">
                <CreateSpaceSeedPreview
                  template={dialog.template}
                  sourceSpace={dialog.sourceSpace}
                  loading={loading && dialog.tab === "templates"}
                />
              </div>
            </aside>
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
              disabled={
                dialog.creating || !dialog.name.trim() || (!dialog.template && !dialog.sourceSpace)
              }
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
