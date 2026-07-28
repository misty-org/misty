import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/ui";
import type { MetadataDialogModel } from "@/models/types/features/spaces/SpaceLibraryDialogs";
import { DialogField } from "./DialogField";

const titles: Record<string, string> = {
  add_tags: "Add tags",
  remove_tags: "Remove tags",
  set_date: "Adjust date",
  set_location: "Set location",
};

/** Bulk metadata edits for the current selection: tags, capture date, or place. */
export function MetadataDialog({ model }: { model: MetadataDialogModel }) {
  const editingTags = model.action === "add_tags" || model.action === "remove_tags";

  return (
    <Dialog
      open={Boolean(model.action)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>{titles[model.action] ?? "Set location"}</DialogTitle>
            <DialogDescription>
              {model.selectedCount} selected item{model.selectedCount === 1 ? "" : "s"} will be
              updated.
            </DialogDescription>
          </DialogHeader>

          {editingTags ? (
            <DialogField label="Tags">
              <Input
                autoFocus
                value={model.tags}
                onChange={(event) => model.setTags(event.target.value)}
                placeholder="travel, family"
              />
            </DialogField>
          ) : model.action === "set_date" ? (
            <DialogField label="Date and time">
              <Input
                autoFocus
                type="datetime-local"
                value={model.date}
                onChange={(event) => model.setDate(event.target.value)}
              />
            </DialogField>
          ) : (
            <div className="grid gap-4">
              <DialogField label="Place name">
                <Input
                  autoFocus
                  value={model.locationName}
                  onChange={(event) => model.setLocationName(event.target.value)}
                  placeholder="Big Sur"
                />
              </DialogField>
              <div className="grid grid-cols-2 gap-3">
                <DialogField label="Latitude">
                  <Input
                    inputMode="decimal"
                    value={model.latitude}
                    onChange={(event) => model.setLatitude(event.target.value)}
                    placeholder="36.2704"
                  />
                </DialogField>
                <DialogField label="Longitude">
                  <Input
                    inputMode="decimal"
                    value={model.longitude}
                    onChange={(event) => model.setLongitude(event.target.value)}
                    placeholder="-121.8079"
                  />
                </DialogField>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving}>
              {model.saving ? "Saving…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
