import type { AlbumDialogModel } from "@/api/spaces/dto/types/SpaceLibraryDialogs";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@/shared/ui";
import { CoverSelect, DialogField } from "./DialogField";

export function AlbumDialog({ model }: { model: AlbumDialogModel }) {
  const creating = model.mode === "create";

  return (
    <Dialog
      open={Boolean(model.mode)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => model.saving && event.preventDefault()}
        onPointerDownOutside={(event) => model.saving && event.preventDefault()}
      >
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{creating ? "New album" : "Edit album"}</DialogTitle>
            <DialogDescription>
              Create a focused collection without moving or duplicating its Library items.
            </DialogDescription>
          </DialogHeader>

          <DialogField label="Name">
            <Input
              autoFocus
              maxLength={120}
              value={model.name}
              onChange={(event) => model.setName(event.target.value)}
            />
          </DialogField>
          <DialogField label="Description">
            <Textarea
              className="min-h-24 resize-y"
              maxLength={2000}
              value={model.description}
              onChange={(event) => model.setDescription(event.target.value)}
            />
          </DialogField>
          {model.mode === "edit" && model.items.length > 0 ? (
            <CoverSelect
              value={model.coverItemId}
              items={model.items}
              label="Album cover"
              onChange={model.setCoverItemId}
            />
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving || !model.name.trim()}>
              {model.saving ? "Saving…" : creating ? "Create album" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
