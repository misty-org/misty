// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogTitle } from "@misty/ui";
import { FilesFrame } from "./FilesFrame";
import { FilesPane } from "./FilesPane";
import type { FilesPlace } from "./model";
import { TransfersView } from "./TransfersView";
import type { FilesPick, FilesPickFooter } from "./files_choices";

/**
 * Files in one pane: the Files page, or the picker apps open (`pick`, with its `footer` of buttons
 * where the bottom bar would be). Transfers, outside the picker, open in a dialog over it.
 */
export function FilesBrowser({
  granted,
  start,
  pick,
  footer,
}: {
  /** The disk grant is on; off, Files reaches the Space drives and the person's projects only. */
  granted: boolean;
  /** Where it opens. */
  start: FilesPlace;
  pick?: FilesPick;
  /** The picker's buttons, from what is picked now and where; `open` goes into a folder or picks a file. */
  footer?: FilesPickFooter;
}) {
  const [transfers, setTransfers] = useState(false);
  return (
    <>
      <FilesFrame picking={Boolean(pick)}>
        {(slots) => (
          <FilesPane
            granted={granted}
            start={start}
            pick={pick}
            footer={footer}
            slots={slots}
            onTransfers={pick ? undefined : () => setTransfers(true)}
          />
        )}
      </FilesFrame>
      <Dialog open={transfers} onOpenChange={setTransfers}>
        <DialogContent size="media" hideClose aria-describedby={undefined}>
          <DialogTitle className="sr-only">Transfers</DialogTitle>
          <DialogBody>
            <TransfersView onClose={() => setTransfers(false)} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
