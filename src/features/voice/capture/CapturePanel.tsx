import { FileText, ListChecks, MessageSquare, Mic, MicOff, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  FloatingPanel,
  IconButton,
  Input,
  Text,
  Textarea,
  Tooltip,
  useNotice,
} from "@misty/ui";
import type { VoiceNoteMode } from "./capture_api";
import { askAboutCapturedNote } from "./open_note";
import { speakersOf } from "./transcript_turns";
import { useCaptureStore } from "./use_capture_store";

const sourceLabel = {
  mic: "Microphone",
  system: "System audio",
  app: "An app",
} as const;

const listeningTo = {
  mic: "the microphone",
  system: "system audio",
  app: "an app",
} as const;

export function CapturePanel() {
  const store = useCaptureStore();
  const notice = store.notice;
  const close = store.close;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [store.turns.length]);
  useNotice(store.phase === "idle" && Boolean(notice), { message: notice ?? "", onDismiss: close });
  if (store.phase === "idle") return null;
  const listening = store.phase === "live" || store.phase === "starting";
  const busy = store.phase === "working" || store.phase === "saving";
  const make = (mode: VoiceNoteMode) => void store.makeNote(mode);
  return (
    <div
      data-misty-notification="true"
      data-misty-window-drag-block="true"
      className="fixed right-4 bottom-4 layer-notification flex max-h-[70vh] flex-col"
    >
      <FloatingPanel
        anchor="free"
        width="lg"
        className="min-h-0"
        title={store.title || "Listening"}
        onClose={listening || busy ? undefined : close}
        actions={
          listening ? (
            <>
              <IconButton
                label={store.muted ? "Unmute microphone" : "Mute microphone"}
                variant="quiet"
                disabled={!store.source?.mic || store.phase !== "live"}
                onClick={() => void store.toggleMute()}
              >
                {store.muted ? <MicOff /> : <Mic />}
              </IconButton>
              <IconButton
                label="Stop"
                variant="quiet"
                disabled={store.phase !== "live"}
                onClick={() => void store.stop()}
              >
                <Square />
              </IconButton>
            </>
          ) : busy ? (
            <IconButton label="Close" size="sm" variant="quiet" disabled>
              <X />
            </IconButton>
          ) : undefined
        }
      >
        <div className="flex min-h-0 flex-col gap-3">
          <Text size="meta" tone="muted">
            {store.phase === "live"
              ? store.source
                ? `Listening to ${listeningTo[store.source.kind]}`
                : "Listening"
              : store.phase === "saving"
                ? "Saving the transcript"
                : store.source
                  ? sourceLabel[store.source.kind]
                  : "Transcript"}
          </Text>
          {notice && (
            <Text as="p" size="meta" tone="muted" role="status" wrap>
              {notice}
            </Text>
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
            <footer className="flex min-w-0 gap-2">
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
            </footer>
          )}
        </div>
      </FloatingPanel>
    </div>
  );
}

function Lanes() {
  const { turns, speakers, phase, rename } = useCaptureStore();
  const [editing, setEditing] = useState<string | null>(null);
  if (!turns.length)
    return phase === "starting" || phase === "live" ? (
      <Text as="p" size="control" tone="muted" role="status" className="m-0">
        Listening
      </Text>
    ) : null;
  return (
    <Text bare as="div" size="control" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {speakersOf(turns).map((speaker) =>
          editing === speaker ? (
            <Input
              key={speaker}
              autoFocus
              aria-label={`Name for ${speaker}`}
              defaultValue={speakers[speaker] ?? speaker}
              variant="compact"
              className="w-32"
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
              <Button variant="quiet" size="sm" onClick={() => setEditing(speaker)}>
                {speakers[speaker] ?? speaker}
              </Button>
            </Tooltip>
          ),
        )}
      </div>
      {turns.map((turn, index) => (
        <p key={`${turn.start}-${index}`} className="leading-snug">
          <Text bare weight="medium">
            {speakers[turn.speaker] ?? turn.speaker}
          </Text>{" "}
          <Text bare tone="muted">
            {turn.text}
          </Text>
        </p>
      ))}
    </Text>
  );
}
