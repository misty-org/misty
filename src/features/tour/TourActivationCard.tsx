import { Button } from "@/shared/ui";
import { Check, Lock, Sparkles, Folder } from "lucide-react";

export function TourActivationCard(props: {
  onFinish: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="flex flex-col md:flex-row items-center gap-6 max-w-2xl w-full">
        {/* Spotlighted Readiness Checklist */}
        <div
          className="w-full max-w-sm rounded-xl border border-[#d4a359] bg-[#171717] p-5 shadow-2xl transition-all"
          style={{
            boxShadow: "0 0 0 1.5px #d4a359, 0 0 24px 2px rgba(212, 163, 89, 0.4)",
          }}
        >
          <div className="border-b border-[#292929] pb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-cream-muted">
              Get Ready to Work
            </h4>
            <p className="mt-1 text-xs text-cream-faint">
              Three essential foundations before your workspace is usable.
            </p>
          </div>

          <div className="mt-4 space-y-3.5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid size-5 place-items-center rounded bg-[#202b23] text-[#a3bfab]">
                <Check size={13} strokeWidth={2.5} />
              </div>
              <div>
                <span className="block text-xs font-medium text-cream">Sign In or Create Account</span>
                <span className="block text-[11px] text-cream-faint">
                  Ensures encrypted cloud sync and cross-device persistence.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid size-5 place-items-center rounded bg-[#202b23] text-[#a3bfab]">
                <Check size={13} strokeWidth={2.5} />
              </div>
              <div>
                <span className="block text-xs font-medium text-cream">Name Your First Space</span>
                <span className="block text-[11px] text-cream-faint">
                  Creates the shared container where members and AI agents interact.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid size-5 place-items-center rounded bg-[#262626] text-cream-muted">
                <Lock size={12} strokeWidth={2} />
              </div>
              <div>
                <span className="block text-xs font-medium text-cream">Storage & Privacy Boundaries</span>
                <span className="block text-[11px] text-cream-faint">
                  Local disk and browser stay private until explicitly shared into a Space.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 Guidance Popover */}
        <div className="w-full max-w-xs rounded-xl border border-charcoal-border bg-[#1c1c1c] p-5 shadow-2xl">
          <div className="flex items-center justify-between text-[11px] font-mono text-cream-faint">
            <span>3 / 3</span>
            <button
              type="button"
              className="text-xs text-cream-faint hover:text-cream-bright"
              onClick={props.onSkip}
            >
              Skip
            </button>
          </div>

          <div className="mt-3">
            <h3 className="text-base font-semibold text-cream-bright">Required to Begin</h3>
            <p className="mt-2 text-xs leading-5 text-cream-muted">
              Misty separates private execution tools and collaborative spaces. Complete these
              steps to collaborate with team members and safely run AI agents.
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs text-cream-muted hover:text-cream-bright"
              onClick={props.onBack}
            >
              Back
            </Button>

            <Button
              type="button"
              size="sm"
              className="h-8 min-w-[90px] bg-[#a3bfab] px-3.5 text-xs font-semibold text-[#111] hover:bg-[#b5cfbc]"
              onClick={props.onFinish}
            >
              Finish & Launch
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
