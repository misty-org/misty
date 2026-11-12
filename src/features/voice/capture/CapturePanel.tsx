import { FileText, ListChecks, MessageSquare, Mic, MicOff, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  IconButton,
  Input,
  OverflowFadeText,
  Skeleton,
  Textarea,
  Tooltip,
  useNotice,
} from "@/shared/ui";
import type { VoiceNoteMode } from "./captureApi";
import { openCapturedNote, askAboutCapturedNote } from "./openNote";
import { speakersOf } from "./transcriptTurns";
import { useCaptureStore } from "./useCaptureStore";

const sourceLabel = {
  mic: "Microphone",
  system: "System audio",
  app: "An app",
} as const;

/**
 * The live Note for a capture: what is being heard, by speaker, with the
 * person's own notes beside it. Mute and Stop stay visible while listening.
 * Once stopped, the transcript turns into a Note in the person's own Space.
 */
export function CapturePanel() {
  const store = useCaptureStore();
  const notice = store.notice;
  const close = store.close;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [store.turns.length]);
  // Once the capture is over, what is left to say is a notice in the corner.
  useNotice(store.phase === "idle" && Boolean(notice), { message: notice ?? "", onDismiss: close });
  if (store.phase === "idle") return null;
  const listening = store.phase === "live" || store.phase === "starting";
  const busy = store.phase === "working" || store.phase === "saving";
  const make = (mode: VoiceNoteMode) => void store.makeNote(mode);
  return (
    <aside
      aria-label="Listening"
      data-misty-notification="true"
      data-misty-window-drag-block="true"
      className="fixed right-4 bottom-4 z-50 flex max-h-[70vh] w-96 flex-col gap-3 rounded-lg border border-cream-border bg-background p-4 shadow-lg"
    >
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <OverflowFadeText as="div" className="text-sm font-medium">
            {store.title || "Listening"}
          </OverflowFadeText>
          <div className="text-xs text-cream-muted">
            {store.source ? sourceLabel[store.source.kind] : "Transcript"}
            {store.phase === "live" ? " · Listening" : store.phase === "saving" ? " · Saving" : ""}
          </div>
        </div>
        {listening ? (
          <>
            <IconButton
              label={store.muted ? "Unmute microphone" : "Mute microphone"}
              disabled={!store.source?.mic || store.phase !== "live"}
              onClick={() => void store.toggleMute()}
            >
              {store.muted ? <MicOff /> : <Mic />}
            </IconButton>
            <Button
              variant="quiet"
              disabled={store.phase !== "live"}
              onClick={() => void store.stop()}
            >
              <Square /> Stop
            </Button>
          </>
        ) : (
          <IconButton label="Close" onClick={close} disabled={busy}>
            <X />
          </IconButton>
        )}
      </header>
      {notice && (
        <p role="status" className="text-xs text-cream-muted">
          {notice}
        </p>
      )}
      <Lanes />
      <div ref={end} />
      <Textarea
        aria-label="Your notes"
        placeholder="Your notes. They're kept as you write them."
        value={store.notes}
        onChange={(event) => store.setNotes(event.target.value)}
        rows={3}
      />
      {!listening && store.transcriptId && (
        <footer className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => make("notes")}>
            <FileText /> {store.noteId ? "Redo notes" : "Turn into notes"}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => make("summary")}>
            Summarize
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => make("actions")}>
            <ListChecks /> Action items
          </Button>
          <Button
            variant="quiet"
            disabled={busy || !store.noteId}
            onClick={() => void askAboutCapturedNote()}
          >
            <MessageSquare /> Ask about it
          </Button>
          {store.noteId && (
            <Button variant="quiet" onClick={openCapturedNote}>
              Open note
            </Button>
          )}
        </footer>
      )}
    </aside>
  );
}

/** One lane per turn, labelled with the speaker's name for this capture. */
function Lanes() {
  const { turns, speakers, phase, rename } = useCaptureStore();
  const [editing, setEditing] = useState<string | null>(null);
  if (!turns.length)
    return phase === "starting" || phase === "live" ? (
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    ) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-sm">
      <div className="flex flex-wrap gap-1">
        {speakersOf(turns).map((speaker) =>
          editing === speaker ? (
            <Input
              key={speaker}
              autoFocus
              aria-label={`Name for ${speaker}`}
              defaultValue={speakers[speaker] ?? speaker}
              className="h-6 w-32 text-xs"
              onBlur={(event) => {
                rename(speaker, event.target.value);
                setEditing(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <Tooltip key={speaker} content="Rename">
              <Button
                variant="quiet"
                className="h-6 px-2 text-xs"
                onClick={() => setEditing(speaker)}
              >
                {speakers[speaker] ?? speaker}
              </Button>
            </Tooltip>
          ),
        )}
      </div>
      {turns.map((turn, index) => (
        <p key={`${turn.start}-${index}`} className="leading-snug">
          <span className="font-medium">{speakers[turn.speaker] ?? turn.speaker}</span>{" "}
          <span className="text-cream-muted">{turn.text}</span>
        </p>
      ))}
    </div>
  );
}
