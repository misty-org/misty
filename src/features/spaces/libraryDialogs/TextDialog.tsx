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
import type { TextDialogModel } from "@/models/types/features/spaces/SpaceLibraryDialogs";
import { DialogField } from "./DialogField";

/** The shared one-or-two-field prompt used for folder, memory and item renames. */
export function TextDialog({ model }: { model: TextDialogModel }) {
  const state = model.state;
  const missingPrimary = state ? state.kind !== "edit-tags" && !state.primaryValue.trim() : false;
  const missingSecondary = state
    ? Boolean(state.secondaryLabel && !state.secondaryValue?.trim())
    : false;

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && !model.saving && model.close()}>
      <DialogContent className="sm:max-w-md">
        {state ? (
          <form className="grid gap-5" onSubmit={model.submit}>
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
              <DialogDescription>Save this change to the current Space Library.</DialogDescription>
            </DialogHeader>

            <DialogField label={state.primaryLabel}>
              <Input
                autoFocus
                maxLength={state.kind === "edit-tags" ? 1000 : 255}
                value={state.primaryValue}
                onChange={(event) =>
                  model.setState((current) =>
                    current ? { ...current, primaryValue: event.target.value } : current,
                  )
                }
              />
            </DialogField>
            {state.secondaryLabel ? (
              <DialogField label={state.secondaryLabel}>
                <Input
                  maxLength={120}
                  value={state.secondaryValue ?? ""}
                  onChange={(event) =>
                    model.setState((current) =>
                      current ? { ...current, secondaryValue: event.target.value } : current,
                    )
                  }
                />
              </DialogField>
            ) : null}
            {model.error ? (
              <p
                className="rounded-lg border border-charcoal-active/25 bg-charcoal-active px-3 py-2 text-sm text-cream-bright"
                role="alert"
              >
                {model.error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={model.saving} onClick={model.close}>
                Cancel
              </Button>
              <Button type="submit" disabled={model.saving || missingPrimary || missingSecondary}>
                {model.saving
                  ? "Saving…"
                  : state.kind === "create-folder"
                    ? "Create"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
