// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): ReleaseNotesPane.tsx.
// See NOTICE.

/**
 * After Misty restarts on an update: what changed, from the release's own notes, once. Closing
 * the dialog marks it read.
 */
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { MistyMarkdown } from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import { type ReleaseNotes, takeReleaseNotes } from "./releaseNotes";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function shownDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : dateFormat.format(parsed);
}

export function ReleaseNotesDialog() {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let closed = false;
    void getVersion()
      .then((version) => {
        const found = takeReleaseNotes(version);
        if (!closed && found) setNotes(found);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, []);
  if (!notes) return null;
  const date = shownDate(notes.date);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : setNotes(null))}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[80vh] w-[600px] max-w-[94vw] flex-col gap-4 p-5"
      >
        <div className="flex items-baseline gap-2 pr-10">
          <DialogTitle className="text-base">What's new in Misty {notes.version}</DialogTitle>
          {date ? <span className="text-sm text-cream-muted">{date}</span> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm text-cream">
          <MistyMarkdown>{notes.notes}</MistyMarkdown>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" autoFocus onClick={() => setNotes(null)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
