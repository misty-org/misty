// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): ReleaseNotesPane.tsx.
// See NOTICE.

import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { MistyMarkdown } from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Text,
} from "@misty/ui";
import { type ReleaseNotes, takeReleaseNotes } from "./release_notes";

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
        size="lg"
        layout="scroll"
        className="max-h-[80vh]"
      >
        <DialogHeader className="flex-row items-baseline gap-2">
          <DialogTitle>What's new in Misty {notes.version}</DialogTitle>
          {date ? (
            <Text size="meta" tone="muted">
              {date}
            </Text>
          ) : null}
        </DialogHeader>
        <DialogBody>
          <Text bare as="div" tone="default">
            <MistyMarkdown size="control">{notes.notes}</MistyMarkdown>
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" size="lg" autoFocus onClick={() => setNotes(null)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
