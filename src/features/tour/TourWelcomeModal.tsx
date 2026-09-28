import { MistyBrandIcon } from "@/features/workspace";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";

export function TourWelcomeModal(props: { onStart: () => void; onSkip: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onSkip()}>
      <DialogContent className="max-w-[400px] gap-0 p-7 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full border border-charcoal-border bg-charcoal-hover text-cream-bright">
          <MistyBrandIcon size={24} />
        </div>
        <DialogTitle className="mt-5 text-base font-semibold text-cream-bright">
          Welcome to Misty
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-cream-muted">
          Find your websites, organize tabs and splits, and work with Agents in your browser
          workspace.
        </DialogDescription>
        <div className="mt-7 space-y-2">
          <Button className="h-9 w-full font-medium" onClick={props.onStart}>
            Get started
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs font-normal text-cream-muted"
            onClick={props.onSkip}
          >
            Skip tour
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
