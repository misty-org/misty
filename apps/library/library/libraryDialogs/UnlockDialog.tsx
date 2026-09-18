import type { UnlockDialogModel } from "@/api/spaces/dto/types/SpaceLibraryDialogs";
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
import { DialogField } from "./DialogField";

/** Password re-authentication for Hidden and Recently Deleted. */
export function UnlockDialog({ model }: { model: UnlockDialogModel }) {
  return (
    <Dialog
      open={Boolean(model.scope)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>
              {model.scope === "hidden" ? "Unlock Hidden" : "Unlock Recently Deleted"}
            </DialogTitle>
            <DialogDescription>
              Enter your Misty password to temporarily access this protected collection.
            </DialogDescription>
          </DialogHeader>

          <DialogField label="Misty password">
            <Input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={model.password}
              onChange={(event) => model.setPassword(event.target.value)}
            />
          </DialogField>
          {model.error ? (
            <p className="text-sm text-cream-bright" role="alert">
              {model.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button type="submit" disabled={model.saving || !model.password}>
              {model.saving ? "Unlocking…" : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
