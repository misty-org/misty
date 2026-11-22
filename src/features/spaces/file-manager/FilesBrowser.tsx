// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import type { ReactNode } from "react";
import { FilesFrame } from "./FilesFrame";
import { FilesPane } from "./FilesPane";
import type { FileItem, FilesPlace } from "./model";
import type { FilesPick } from "./useFilesBrowser";

const nothing = () => undefined;

/**
 * Files in one pane, with no tabs or workspaces: the picker apps open (`pick`, with its `footer` of
 * buttons where the bottom bar would be). The Files page is `FilesWindow`.
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
  /** The picker's buttons, from what is picked now; `open` goes into a folder or picks a file. */
  footer?: (picked: FileItem[], open: (item: FileItem) => void) => ReactNode;
}) {
  return (
    <FilesFrame picking={Boolean(pick)}>
      {(slots) => (
        <FilesPane
          granted={granted}
          start={start}
          pick={pick}
          footer={footer}
          host={{ active: true, slots, count: 1, onFocus: nothing, onPlace: nothing }}
        />
      )}
    </FilesFrame>
  );
}
