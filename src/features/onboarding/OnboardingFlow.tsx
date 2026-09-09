import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces/core";
import { spacesApi } from "@/api/spaces/api";
import { useCreateSpaceDialog } from "@/features/spaces/creation";
import { CreateSpaceNameStep, CreateSpaceTemplateStep } from "@/features/spaces/creation";
import { SpaceAppSelection } from "@/features/spaces/creation";
import { Button } from "@/shared/ui";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { accountNeedsOnboarding, clearAccountCreating } from "./onboardingState";
import { trackOnboardingCompleted } from "@/telemetry/lifecycle";
export function OnboardingFlow() {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const ready = useSpacesStore((state) => state.snapshotReady);
  const visible = accountNeedsOnboarding(user?.id, ready, spaces);
  const dialog = useCreateSpaceDialog({
    clearError: () => useSpacesStore.getState().clearError(),
    createSpace: async (input) => {
      const result = await spacesApi.create(input);
      if (user?.id) {
        clearAccountCreating(user.id);
        await useSpacesStore.getState().load({ accountId: user.id, force: true });
      }
      void trackOnboardingCompleted();
      return result;
    },
  });
  const { setOpen } = dialog;
  useEffect(() => {
    setOpen(visible);
  }, [visible, setOpen]);
  if (!visible) return null;
  return createPortal(
    <section
      className="fixed inset-0 z-[80] overflow-y-auto bg-charcoal-bg text-cream"
      aria-label="Set up Misty"
      data-misty-onboarding
    >
      <form className="mx-auto max-w-xl px-6 py-10" onSubmit={(event) => void dialog.submit(event)}>
        <h1 className="text-2xl font-semibold">Create your first Space</h1>
        <p className="mt-2 text-sm text-cream-muted">
          Choose a place and the tools for what you want to do.
        </p>
        {dialog.step === 0 ? (
          <CreateSpaceNameStep name={dialog.name} onName={dialog.setName} />
        ) : (
          <>
            <CreateSpaceTemplateStep
              templates={dialog.templates}
              templateId={dialog.templateId}
              onTemplate={dialog.setTemplateId}
            />
            <SpaceAppSelection
              catalog={dialog.catalog}
              selected={dialog.selectedApps}
              onChange={dialog.setSelectedApps}
            />
          </>
        )}
        {(dialog.loadError || dialog.createError) && (
          <p role="alert" className="mt-3 text-sm">
            {dialog.loadError || dialog.createError}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {dialog.step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={dialog.creating}
              onClick={() => dialog.setStep(0)}
            >
              Back
            </Button>
          )}
          {dialog.step === 0 ? (
            <Button type="button" disabled={!dialog.name.trim()} onClick={() => dialog.setStep(1)}>
              Continue
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={dialog.creating || !dialog.selectionValid || !!dialog.loadError}
            >
              {dialog.creating ? "Creating…" : "Create Space"}
            </Button>
          )}
        </div>
      </form>
    </section>,
    document.body,
  );
}
