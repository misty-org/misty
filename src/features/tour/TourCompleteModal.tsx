import { CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui";

export function TourCompleteModal(props: {
  onFinish: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-complete-title"
    >
      <div className="w-full max-w-[400px] rounded-xl border border-charcoal-border bg-charcoal-card p-7 text-center shadow-2xl ring-1 ring-cream/10">
        <div className="mx-auto grid size-12 place-items-center rounded-full border border-charcoal-border bg-charcoal-hover text-cream-bright">
          <CheckCircle2 size={24} />
        </div>

        <h2
          id="tour-complete-title"
          className="mt-5 text-base font-semibold text-cream-bright"
        >
          You're all set!
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-cream-muted">
          Your workspace is ready. You can reopen this tour at any time from your Profile or from Settings &gt; Help.
        </p>

        <div className="mt-7">
          <Button
            type="button"
            variant="default"
            size="default"
            className="w-full h-9 font-medium"
            onClick={props.onFinish}
          >
            Start working
          </Button>
        </div>
      </div>
    </div>
  );
}
