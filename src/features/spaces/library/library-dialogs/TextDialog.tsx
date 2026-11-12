import type { TextDialogModel } from "./libraryDialogTypes";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useNotice,
} from "@/shared/ui";
import { DialogField } from "./DialogField";

/** The shared one-or-two-field prompt used for folder, memory and item renames. */
export function TextDialog({ model }: { model: TextDialogModel }) {
  const state = model.state;
  useNotice(Boolean(state && model.error), { message: model.error ?? "", tone: "error" });
  const missingPrimary = state ? state.kind !== "edit-tags" && !state.primaryValue.trim() : false;
  const missingSecondary = state
    ? Boolean(state.secondaryLabel && !state.secondaryValue?.trim())
    : false;

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && !model.saving && model.close()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        {state ? (
          <form className="grid gap-5" onSubmit={model.submit}>
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
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

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={model.saving}
                onClick={model.close}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={model.saving || missingPrimary || missingSecondary}>
                {model.saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
