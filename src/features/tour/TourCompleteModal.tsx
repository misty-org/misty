import { CheckCircle2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";

export function TourCompleteModal(props: { onFinish: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onFinish()}>
      <DialogContent className="max-w-[400px] gap-0 p-7 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full border border-charcoal-border bg-charcoal-hover text-cream-bright">
          <CheckCircle2 size={24} />
        </div>
        <DialogTitle className="mt-5 text-base font-semibold text-cream-bright">
          You're all set!
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-cream-muted">
          You can reopen this walkthrough from your profile menu.
        </DialogDescription>
        <div className="mt-7">
          <Button className="h-9 w-full font-medium" onClick={props.onFinish}>
            Start working
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
