import { BrowserImportFlow } from "@/features/browser-import";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";

/** Onboarding's second step: bring the browser the person used before. */
export function TourImportModal(props: { onContinue: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onContinue()}>
      <DialogContent className="gap-4 p-7 sm:max-w-md">
        <DialogTitle className="text-base font-semibold text-cream-bright">
          Import from your browser
        </DialogTitle>
        <DialogDescription className="sr-only">
          Bring bookmarks, history, settings and sign-ins into Misty, or skip this step.
        </DialogDescription>
        <BrowserImportFlow onClose={props.onContinue} closeLabel="Skip" />
      </DialogContent>
    </Dialog>
  );
}
