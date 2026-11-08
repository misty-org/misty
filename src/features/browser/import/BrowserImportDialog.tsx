import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { BrowserImportFlow } from "./BrowserImportFlow";

/** The import flow in the shared compact dialog (Settings and the Bookmarks page). */
export function BrowserImportDialog(props: { onClose(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Import from another browser</DialogTitle>
        <DialogDescription className="sr-only">
          Choose a browser, then what to bring into Misty.
        </DialogDescription>
        <BrowserImportFlow onClose={props.onClose} />
      </DialogContent>
    </Dialog>
  );
}
