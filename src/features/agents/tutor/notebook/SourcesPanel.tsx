import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  FileText,
  Globe,
  Link2,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  StickyNote,
  Type,
} from "lucide-react";
import { Button, Checkbox, IconButton, Input, Pressable } from "@/shared/ui";
import { jobTitle } from "../tutorPrompts";
import { startJob } from "../tutorRuns";
import { researchPrompt } from "../tutorStudio";
import { useTutorStore } from "../tutorStore";
import type { Notebook, NotebookSource } from "../tutorTypes";

export type Opened = { kind: "source" | "note"; id: string };

function sourceIcon(source: NotebookSource) {
  if (source.kind === "recording") return <Mic size={15} />;
  if (source.kind === "text") return <Type size={15} />;
  if (source.kind === "file") return <FileText size={15} />;
  const host = source.url ? new URL(source.url).hostname : "";
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return <Play size={15} />;
  return <Link2 size={15} />;
}

/**
 * The notebook's left panel: back to Tutor, add sources or a note, find sources on the web, and
 * every source and note with a box for whether questions and the studio use it. Opening one shows
 * it in the middle.
 */
export function SourcesPanel({
  notebook,
  agentId,
  collapsed,
  opened,
  onCollapse,
  onAdd,
  onOpen,
  onNewNote,
  onError,
}: {
  notebook: Notebook;
  agentId: string;
  collapsed: boolean;
  opened?: Opened;
  onCollapse(collapsed: boolean): void;
  onAdd(): void;
  onOpen(item: Opened): void;
  onNewNote(): void;
  onError(message: string): void;
}) {
  const store = useTutorStore.getState();
  const jobs = useTutorStore((state) => state.jobs);
  const [query, setQuery] = useState("");
  const researching = Object.values(jobs).filter(
    (job) =>
      job.notebookId === notebook.id &&
      job.kind === "research" &&
      (job.state === "queued" || job.state === "running"),
  );
  const included = notebook.sources.filter((source) => source.context !== "off").length;
  const all = notebook.sources.length > 0 && included === notebook.sources.length;

  const research = (event?: FormEvent) => {
    event?.preventDefault();
    const topic = query.trim();
    if (!topic) return;
    setQuery("");
    const have = notebook.sources.flatMap((source) => (source.url ? [source.url] : []));
    void startJob({
      kind: "research",
      title: jobTitle("research", topic),
      agentId,
      notebookId: notebook.id,
      prompt: researchPrompt(topic, have),
    }).catch((reason: unknown) => onError(String(reason)));
  };
  const setAll = (on: boolean) =>
    store.updateNotebook(notebook.id, (current) => ({
      ...current,
      sources: current.sources.map((source) => ({
        ...source,
        context: on ? (source.context === "off" ? "full" : source.context) : "off",
      })),
    }));

  if (collapsed)
    return (
      <aside className="tutor-pane tutor-pane-rail" aria-label="Sources">
        <IconButton label="Show sources" onClick={() => onCollapse(false)}>
          <PanelLeftOpen size={16} />
        </IconButton>
        <IconButton label="Add sources" onClick={onAdd}>
          <Plus size={16} />
        </IconButton>
      </aside>
    );

  return (
    <aside className="tutor-pane tutor-sources-pane" aria-label="Sources">
      <header className="tutor-pane-head">
        <h2>Sources</h2>
        <IconButton label="Hide sources" onClick={() => onCollapse(true)}>
          <PanelLeftClose size={16} />
        </IconButton>
      </header>
      <div className="tutor-pane-actions">
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus size={15} />
          Sources
        </Button>
        <Button variant="outline" size="sm" onClick={onNewNote}>
          <Plus size={15} />
          Note
        </Button>
      </div>
      <form className="tutor-research" onSubmit={research}>
        <Globe size={15} aria-hidden="true" />
        <Input
          variant="toolbar"
          aria-label="Search the web for new sources"
          placeholder="Search the web for new sources"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton label="Find sources" type="submit" disabled={!query.trim()}>
          <ArrowRight size={15} />
        </IconButton>
      </form>

      <div className="tutor-pane-scroll">
        {researching.map((job) => (
          <div key={job.id} className="tutor-source-item" aria-busy="true">
            <Globe size={15} className="tutor-source-icon" />
            <span className="misty-shimmer truncate">
              {job.state === "queued" ? "Waiting to search the web" : "Searching the web"}
            </span>
          </div>
        ))}
        {notebook.sources.length ? (
          <label className="tutor-select-all">
            <span>Select all</span>
            <Checkbox checked={all} onCheckedChange={(on) => setAll(on === true)} />
          </label>
        ) : null}
        {notebook.sources.map((source) => (
          <div
            key={source.id}
            className="tutor-source-item"
            data-open={opened?.kind === "source" && opened.id === source.id ? "true" : undefined}
            data-off={source.context === "off" ? "true" : undefined}
          >
            <Pressable
              className="tutor-source-open"
              onClick={() => onOpen({ kind: "source", id: source.id })}
            >
              <span className="tutor-source-icon">{sourceIcon(source)}</span>
              <span className={source.reading ? "truncate misty-shimmer" : "truncate"}>
                {source.title}
              </span>
            </Pressable>
            <Checkbox
              aria-label={`Use ${source.title}`}
              checked={source.context !== "off"}
              onCheckedChange={(on) =>
                store.updateSource(notebook.id, source.id, {
                  context: on === true ? "full" : "off",
                })
              }
            />
          </div>
        ))}
        {notebook.notes.length ? <p className="tutor-pane-label">Notes</p> : null}
        {notebook.notes.map((note) => (
          <Pressable
            key={note.id}
            className="tutor-source-item tutor-source-open"
            data-open={opened?.kind === "note" && opened.id === note.id ? "true" : undefined}
            onClick={() => onOpen({ kind: "note", id: note.id })}
          >
            <span className="tutor-source-icon">
              <StickyNote size={15} />
            </span>
            <span className="truncate">{note.title || "Untitled note"}</span>
          </Pressable>
        ))}
        {!notebook.sources.length && !researching.length ? (
          <div className="tutor-pane-empty">
            <FileText size={22} aria-hidden="true" />
            <p>Saved sources will appear here.</p>
            <Button variant="outline" size="sm" onClick={onAdd}>
              Add sources
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
