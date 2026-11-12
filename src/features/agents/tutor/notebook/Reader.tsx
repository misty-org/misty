import { useEffect, useState } from "react";
import { ArrowLeft, Plus, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { Button, IconButton, Input, SegmentedControl, Textarea } from "@/shared/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import {
  builtinTransformations,
  jobTitle,
  summaryPrompt,
  transformationPrompt,
} from "../tutorPrompts";
import { startJob } from "../tutorRuns";
import { readLink } from "../tutorSources";
import { useTutorStore } from "../tutorStore";
import type { Notebook, NotebookNote, NotebookSource, SourceContext } from "../tutorTypes";

const contexts: { value: SourceContext; label: string }[] = [
  { value: "full", label: "Full text" },
  { value: "summary", label: "Summary" },
  { value: "off", label: "Left out" },
];

/**
 * A source opened in the middle of a notebook, after NotebookLM's source guide: how much of it
 * questions get, the agent's summary of it, transformations to run on it, and its text.
 */
export function SourceReader({
  notebook,
  source,
  agentId,
  onClose,
  onError,
}: {
  notebook: Notebook;
  source: NotebookSource;
  agentId: string;
  onClose(): void;
  onError(message: string): void;
}) {
  const store = useTutorStore.getState();
  const jobs = useTutorStore((state) => state.jobs);
  const [making, setMaking] = useState<{ title: string; prompt: string }>();
  const busy = (kind: string, transformation?: string) =>
    Object.values(jobs).some(
      (job) =>
        job.sourceId === source.id &&
        job.kind === kind &&
        (!transformation || job.transformation === transformation) &&
        (job.state === "queued" || job.state === "running"),
    );
  const fail = (reason: unknown) =>
    onError(reason instanceof Error ? reason.message : String(reason));
  const summarize = () =>
    void startJob({
      kind: "summary",
      title: jobTitle("summary", source.title),
      agentId,
      notebookId: notebook.id,
      sourceId: source.id,
      prompt: summaryPrompt(notebook, source),
    }).catch(fail);
  const transform = (id: string) => {
    const transformation = [...builtinTransformations, ...notebook.transformations].find(
      (item) => item.id === id,
    );
    if (!transformation) return;
    void startJob({
      kind: "note",
      title: `${transformation.title}: ${source.title}`,
      agentId,
      notebookId: notebook.id,
      sourceId: source.id,
      transformation: transformation.id,
      prompt: transformationPrompt(notebook, source, transformation),
    }).catch(fail);
  };

  return (
    <section className="tutor-pane tutor-chat-pane" aria-label={source.title}>
      <div className="tutor-chat-scroll">
        <div className="tutor-reader-head">
          <IconButton label="Back to chat" onClick={onClose}>
            <ArrowLeft size={16} />
          </IconButton>
          <h2 className="truncate">{source.title}</h2>
          <IconButton
            label="Remove source"
            onClick={() => {
              store.removeSource(notebook.id, source.id);
              onClose();
            }}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
        {source.url ? (
          <a className="tutor-reader-link" href={source.url} target="_blank" rel="noreferrer">
            {source.url}
          </a>
        ) : null}
        {source.why ? <p className="tutor-card-detail">{source.why}</p> : null}
        <SegmentedControl<SourceContext>
          label="What questions get"
          value={source.context}
          options={contexts}
          onChange={(context) => {
            store.updateSource(notebook.id, source.id, { context });
            if (context === "summary" && !source.summary) summarize();
          }}
        />

        <div className="tutor-reader-card">
          <div className="tutor-reader-card-head">
            <h3>Summary</h3>
            <Button variant="ghost" size="sm" disabled={busy("summary")} onClick={summarize}>
              <RotateCcw size={14} />
              {source.summary ? "Again" : "Summarize"}
            </Button>
          </div>
          {busy("summary") ? (
            <span className="tutor-card-detail misty-shimmer">Summarizing</span>
          ) : source.summary ? (
            <MistyMarkdown>{source.summary}</MistyMarkdown>
          ) : null}
        </div>

        <div className="tutor-reader-card">
          <div className="tutor-reader-card-head">
            <h3>Transform</h3>
          </div>
          <div className="tutor-cover-topics">
            {[...builtinTransformations, ...notebook.transformations].map((item) => (
              <Button
                key={item.id}
                variant="outline"
                size="sm"
                disabled={busy("note", item.id)}
                onClick={() => transform(item.id)}
              >
                <Wand2 size={14} />
                {item.title}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setMaking({ title: "", prompt: "" })}>
              <Plus size={14} />
              Your own
            </Button>
          </div>
          {making ? (
            <form
              className="tutor-card-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!making.title.trim() || !making.prompt.trim()) return;
                const id = `transformation-${crypto.randomUUID()}`;
                store.updateNotebook(notebook.id, (current) => ({
                  ...current,
                  transformations: [
                    ...current.transformations,
                    { id, title: making.title.trim(), prompt: making.prompt.trim() },
                  ],
                }));
                setMaking(undefined);
              }}
            >
              <Input
                aria-label="Name"
                placeholder="Name"
                value={making.title}
                onChange={(event) => setMaking({ ...making, title: event.target.value })}
              />
              <Textarea
                rows={3}
                aria-label="What to do with a source"
                placeholder="What to do with a source, such as “List every date and what happened.”"
                value={making.prompt}
                onChange={(event) => setMaking({ ...making, prompt: event.target.value })}
              />
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
          ) : null}
        </div>

        <div className="tutor-reader-card">
          <div className="tutor-reader-card-head">
            <h3>Text</h3>
            {source.kind === "link" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={source.reading}
                onClick={() =>
                  void readLink(notebook.id, source).then((failed) => failed && onError(failed))
                }
              >
                <RotateCcw size={14} />
                Read again
              </Button>
            ) : null}
          </div>
          {source.reading ? (
            <span className="tutor-card-detail misty-shimmer">Reading</span>
          ) : source.text ? (
            <pre className="tutor-source-text">{source.text.slice(0, 60_000)}</pre>
          ) : (
            <span className="tutor-card-detail">Misty has no text for this source yet.</span>
          )}
        </div>
      </div>
    </section>
  );
}

/** A note opened in the middle: written in Markdown, shown as it reads. */
export function NoteReader({
  notebook,
  note,
  onClose,
}: {
  notebook: Notebook;
  note?: NotebookNote;
  onClose(): void;
}) {
  const store = useTutorStore.getState();
  const [editing, setEditing] = useState(!note);
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  useEffect(() => {
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setEditing(!note);
  }, [note]);
  const save = () => {
    if (!body.trim()) return;
    store.saveNote(notebook.id, { id: note?.id, title: title.trim() || "Untitled note", body });
    setEditing(false);
    if (!note) onClose();
  };
  return (
    <section className="tutor-pane tutor-chat-pane" aria-label="Note">
      <div className="tutor-chat-scroll">
        <div className="tutor-reader-head">
          <IconButton label="Back to chat" onClick={onClose}>
            <ArrowLeft size={16} />
          </IconButton>
          <h2 className="truncate">{note ? note.title || "Untitled note" : "New note"}</h2>
          {note ? (
            <IconButton
              label="Delete note"
              onClick={() => {
                store.removeNote(notebook.id, note.id);
                onClose();
              }}
            >
              <Trash2 size={15} />
            </IconButton>
          ) : null}
        </div>
        {editing ? (
          <div className="tutor-card-form">
            <Input
              aria-label="Title"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              rows={14}
              aria-label="Note"
              placeholder="Write in Markdown"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="flex gap-1.5">
              <Button size="sm" disabled={!body.trim()} onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (note ? setEditing(false) : onClose())}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : note ? (
          <>
            <div className="tutor-guide">
              <MistyMarkdown>{note.body}</MistyMarkdown>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
