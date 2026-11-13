import { useEffect, useState } from "react";
import { ArrowLeft, Plus, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { Button, ChoiceGroup, IconButton, Input, Surface, Text, Textarea } from "@/shared/ui";
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
import { middleScrollClass, paneClass } from "./panes";

/** A box in a source's guide: its summary, its transformations, its text. */
const cardClass = "flex flex-col gap-2 px-3.5 py-3 text-control leading-[1.6]";
/** A box's heading and its one action. */
const cardHeadClass = "flex items-center justify-between";
/** The head of what's open in the middle: back, its name, and its one action. */
const headClass = "flex items-center gap-2";

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
    <section className={`${paneClass} flex-1`} aria-label={source.title}>
      <div className={middleScrollClass}>
        <div className={headClass}>
          <IconButton label="Back to chat" onClick={onClose}>
            <ArrowLeft />
          </IconButton>
          <Text as="h2" size="title" weight="semibold" tone="bright" className="flex-1">
            {source.title}
          </Text>
          <IconButton
            label="Remove source"
            onClick={() => {
              store.removeSource(notebook.id, source.id);
              onClose();
            }}
          >
            <Trash2 />
          </IconButton>
        </div>
        {source.url ? (
          <Text bare size="caption" tone="muted" className="underline [overflow-wrap:anywhere]">
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.url}
            </a>
          </Text>
        ) : null}
        {source.why ? (
          <Text as="p" size="caption" tone="muted" wrap>
            {source.why}
          </Text>
        ) : null}
        <ChoiceGroup<SourceContext>
          label="What questions get"
          value={source.context}
          options={contexts}
          onChange={(context) => {
            store.updateSource(notebook.id, source.id, { context });
            if (context === "summary" && !source.summary) summarize();
          }}
        />

        <Surface tone="page" edge="hairline" radius="xl" className={cardClass}>
          <div className={cardHeadClass}>
            <Text as="h3" size="meta" weight="medium" tone="muted">
              Summary
            </Text>
            <Button variant="quiet" disabled={busy("summary")} onClick={summarize} icon={RotateCcw}>
              {source.summary ? "Again" : "Summarize"}
            </Button>
          </div>
          {busy("summary") ? (
            <Text bare size="caption" tone="muted" className="flex-none misty-shimmer">
              Summarizing
            </Text>
          ) : source.summary ? (
            <MistyMarkdown>{source.summary}</MistyMarkdown>
          ) : null}
        </Surface>

        <Surface tone="page" edge="hairline" radius="xl" className={cardClass}>
          <div className={cardHeadClass}>
            <Text as="h3" size="meta" weight="medium" tone="muted">
              Transform
            </Text>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...builtinTransformations, ...notebook.transformations].map((item) => (
              <Button
                key={item.id}
                disabled={busy("note", item.id)}
                onClick={() => transform(item.id)}
                icon={Wand2}
              >
                {item.title}
              </Button>
            ))}
            <Button
              variant="quiet"
              onClick={() => setMaking({ title: "", prompt: "" })}
              icon={Plus}
            >
              Your own
            </Button>
          </div>
          {making ? (
            <form
              className="flex flex-col gap-2 [&>button]:self-start"
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
              <Button type="submit">Save</Button>
            </form>
          ) : null}
        </Surface>

        <Surface tone="page" edge="hairline" radius="xl" className={cardClass}>
          <div className={cardHeadClass}>
            <Text as="h3" size="meta" weight="medium" tone="muted">
              Text
            </Text>
            {source.kind === "link" ? (
              <Button
                variant="quiet"
                disabled={source.reading}
                onClick={() =>
                  void readLink(notebook.id, source).then((failed) => failed && onError(failed))
                }
                icon={RotateCcw}
              >
                Read again
              </Button>
            ) : null}
          </div>
          {source.reading ? (
            <Text bare size="caption" tone="muted" className="flex-none misty-shimmer">
              Reading
            </Text>
          ) : source.text ? (
            <Text bare as="div" tone="muted">
              <pre className="max-h-65 overflow-auto font-sans text-caption leading-[1.55] whitespace-pre-wrap">
                {source.text.slice(0, 60_000)}
              </pre>
            </Text>
          ) : (
            <Text bare size="caption" tone="muted" className="flex-none">
              Misty has no text for this source yet.
            </Text>
          )}
        </Surface>
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
    <section className={`${paneClass} flex-1`} aria-label="Note">
      <div className={middleScrollClass}>
        <div className={headClass}>
          <IconButton label="Back to chat" onClick={onClose}>
            <ArrowLeft />
          </IconButton>
          <Text as="h2" size="title" weight="semibold" tone="bright" className="flex-1">
            {note ? note.title || "Untitled note" : "New note"}
          </Text>
          {note ? (
            <IconButton
              label="Delete note"
              onClick={() => {
                store.removeNote(notebook.id, note.id);
                onClose();
              }}
            >
              <Trash2 />
            </IconButton>
          ) : null}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
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
              <Button disabled={!body.trim()} onClick={save}>
                Save
              </Button>
              <Button variant="quiet" onClick={() => (note ? setEditing(false) : onClose())}>
                Cancel
              </Button>
            </div>
          </div>
        ) : note ? (
          <>
            <Text bare as="div" size="control" tone="default" className="max-w-190 leading-[1.7]">
              <MistyMarkdown>{note.body}</MistyMarkdown>
            </Text>
            <Button onClick={() => setEditing(true)}>Edit</Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
