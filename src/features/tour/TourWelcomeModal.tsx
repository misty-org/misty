import { MistyBrandIcon } from "@/features/workspace";
import { Button } from "@/shared/ui";

export function TourWelcomeModal(props: {
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-welcome-title"
    >
      <div className="w-full max-w-[400px] rounded-xl border border-charcoal-border bg-charcoal-card p-7 text-center shadow-2xl ring-1 ring-cream/10">
        <div className="mx-auto grid size-12 place-items-center rounded-full border border-charcoal-border bg-charcoal-hover text-cream-bright">
          <MistyBrandIcon size={24} />
        </div>

        <h2
          id="tour-welcome-title"
          className="mt-5 text-base font-semibold text-cream-bright"
        >
          Welcome to Misty
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-cream-muted">
          A guided walkthrough to explore where everything is, how apps dock to your navbar, and how to work across spaces and virtual windows.
        </p>

        <div className="mt-7 space-y-2">
          <Button
            type="button"
            variant="default"
            size="default"
            className="w-full h-9 font-medium"
            onClick={props.onStart}
          >
            Get started
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-xs text-cream-muted hover:text-cream-bright font-normal"
            onClick={props.onSkip}
          >
            Skip tour
          </Button>
        </div>
      </div>
    </div>
  );
}
