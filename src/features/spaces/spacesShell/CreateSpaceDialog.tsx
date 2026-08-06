import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import {
  CreateSpaceConnectionsStep,
  CreateSpaceNameStep,
  CreateSpaceTemplateStep,
} from "./CreateSpaceSteps";
import { CREATE_STEP_COUNT, type useCreateSpaceDialog } from "./useCreateSpaceDialog";

export function CreateSpaceDialog({
  dialog,
  error,
}: {
  dialog: ReturnType<typeof useCreateSpaceDialog>;
  error: string;
}) {
  const lastStep = CREATE_STEP_COUNT - 1;

  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => (open ? dialog.setOpen(true) : dialog.close())}
    >
      <DialogContent className="max-w-lg">
        <form onSubmit={(event) => void dialog.submit(event)}>
          <DialogHeader>
            <DialogTitle>Create a Space</DialogTitle>
            <DialogDescription>
              Get your team organized in a few seconds. Everything can be changed later.
            </DialogDescription>
          </DialogHeader>

          <div
            className="mt-5 flex gap-1.5"
            aria-label={`Step ${dialog.step + 1} of ${CREATE_STEP_COUNT}`}
          >
            {Array.from({ length: CREATE_STEP_COUNT }, (_, step) => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full ${step <= dialog.step ? "bg-charcoal-active" : "bg-charcoal-card"}`}
              />
            ))}
          </div>

          {dialog.step === 0 ? (
            <CreateSpaceNameStep name={dialog.name} onName={dialog.setName} />
          ) : null}
          {dialog.step === 1 ? (
            <CreateSpaceTemplateStep
              templates={dialog.templates}
              templateId={dialog.templateId}
              templateError={dialog.templateError}
              onTemplate={dialog.setTemplateId}
            />
          ) : null}
          {dialog.step === 2 ? (
            <CreateSpaceConnectionsStep
              providers={dialog.providers}
              availability={dialog.providerAvailability}
              onToggle={(provider) =>
                dialog.setProviders((current) =>
                  current.includes(provider)
                    ? current.filter((item) => item !== provider)
                    : [...current, provider],
                )
              }
            />
          ) : null}

          {error ? (
            <p
              className="mb-0 mt-3 rounded-lg border border-charcoal-active/25 bg-charcoal-active px-3 py-2 text-xs leading-relaxed text-cream-bright"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter className="mt-5">
            <Button
              variant="outline"
              type="button"
              disabled={dialog.creating}
              onClick={() =>
                dialog.step === 0 ? dialog.close() : dialog.setStep((step) => step - 1)
              }
            >
              {dialog.step === 0 ? (
                "Cancel"
              ) : (
                <>
                  <ChevronLeft size={14} /> Back
                </>
              )}
            </Button>
            {dialog.step < lastStep ? (
              <Button
                type="button"
                disabled={dialog.step === 0 && !dialog.name.trim()}
                onClick={() => dialog.setStep((step) => step + 1)}
              >
                Continue <ChevronRight size={14} />
              </Button>
            ) : (
              <Button type="submit" disabled={dialog.creating || !dialog.name.trim()}>
                {dialog.creating ? "Creating..." : "Create Space"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
