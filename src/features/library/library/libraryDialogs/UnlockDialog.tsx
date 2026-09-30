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

/** A separate library password protects Hidden and Recently Deleted. */
export function UnlockDialog({ model }: { model: UnlockDialogModel }) {
  const setup = model.configured === false;
  const checking = model.configured === null;
  return (
    <Dialog
      open={Boolean(model.scope)}
      onOpenChange={(open) => !open && !model.saving && model.close()}
    >
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-5" onSubmit={model.submit}>
          <DialogHeader>
            <DialogTitle>
              {setup
                ? "Set your library password"
                : model.scope === "hidden"
                  ? "Unlock Hidden"
                  : "Unlock Recently Deleted"}
            </DialogTitle>
            <DialogDescription>
              {setup
                ? "Create a separate password for Hidden and Recently Deleted. This password protects your library across devices and does not change how you sign in to Misty."
                : "Enter your library password to temporarily access this protected collection."}
            </DialogDescription>
          </DialogHeader>

          {checking ? (
            <p className="text-sm text-cream-muted" role="status">
              Checking library lock…
            </p>
          ) : (
            <DialogField label={setup ? "New library password" : "Library password"}>
              <Input
                autoFocus
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                minLength={setup ? 8 : undefined}
                maxLength={72}
                required
                disabled={model.saving}
                value={model.password}
                onChange={(event) => model.setPassword(event.target.value)}
              />
            </DialogField>
          )}
          {setup ? (
            <DialogField label="Confirm library password">
              <Input
                type="password"
                autoComplete="new-password"
                value={model.confirmation}
                required
                disabled={model.saving}
                onChange={(event) => model.setConfirmation(event.target.value)}
              />
            </DialogField>
          ) : null}
          {model.error ? (
            <p className="text-sm text-cream-bright" role="alert">
              {model.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                checking || model.saving || !model.password || (setup && !model.confirmation)
              }
            >
              {model.saving
                ? setup
                  ? "Setting password…"
                  : "Unlocking…"
                : setup
                  ? "Set password and unlock"
                  : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
