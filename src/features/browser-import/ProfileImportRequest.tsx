import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { BrowserImportFlow } from "./BrowserImportFlow";
import { takeProfileImport } from "./profileImport";

/** Runs the import this window was opened for, from another browser's profile. */
export function ProfileImportRequest() {
  const [handOff, setHandOff] = useState(takeProfileImport);
  if (!handOff) return null;
  const close = () => setHandOff(null);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Import from another browser</DialogTitle>
        <DialogDescription className="sr-only">
          Bringing {handOff.source.name} into this profile.
        </DialogDescription>
        <BrowserImportFlow onClose={close} start={handOff} />
      </DialogContent>
    </Dialog>
  );
}
