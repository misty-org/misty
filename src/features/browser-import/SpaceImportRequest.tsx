import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui";
import { BrowserImportFlow } from "./BrowserImportFlow";
import { takeSpaceImport } from "./spaceImport";

/** Runs the import this Space window was opened for, from another browser's profile. */
export function SpaceImportRequest() {
  const [handOff, setHandOff] = useState(takeSpaceImport);
  if (!handOff) return null;
  const close = () => setHandOff(null);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Import from another browser</DialogTitle>
        <DialogDescription className="sr-only">
          Bringing {handOff.source.name} into this Space.
        </DialogDescription>
        <BrowserImportFlow onClose={close} start={handOff} />
      </DialogContent>
    </Dialog>
  );
}
