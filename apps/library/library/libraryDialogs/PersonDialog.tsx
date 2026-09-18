import type { PersonDialogModel } from "@/api/spaces/dto/types/SpaceLibraryDialogs";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { CoverSelect, DialogField } from "./DialogField";

export function PersonDialog({ model }: { model: PersonDialogModel }) {
  const subject = model.kind === "pet" ? "pet" : "person";
  const creating = model.mode === "create";
  const title = creating ? `New ${subject}` : `Edit ${subject}`;

  return (
    <Dialog
      open={Boolean(model.mode)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Name this {subject} so Misty can keep related Library items together.
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
          {model.mode === "edit" && model.items.length > 0 ? (
            <CoverSelect
              value={model.coverItemId}
              items={model.items}
              label={`${title} cover`}
              onChange={model.setCoverItemId}
            />
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving}>
              {model.saving ? "Saving…" : creating ? `Create ${subject}` : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
