import { useState, type DragEvent, type FormEvent } from "react";
import { ArrowRight, Clipboard, Globe, Link2, Mic, Upload } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Input,
  Progress,
  Textarea,
} from "@/shared/ui";
import { jobTitle } from "../tutorPrompts";
import { startJob } from "../tutorRuns";
import {
  addDroppedFiles,
  addLink,
  addPickedFiles,
  addRecordings,
  addText,
  sourceLimit,
} from "../tutorSources";
import { researchPrompt } from "../tutorStudio";
import type { Notebook } from "../tutorTypes";

type Mode = "choose" | "links" | "text";

/**
 * Adding sources, after NotebookLM: search the web for them, or bring files, recordings, web pages
 * and videos, or pasted text, or drop files anywhere on it. The bar shows how full the notebook is.
 */
export function AddSourcesDialog({
  notebook,
  agentId,
  open,
  onClose,
  onError,
}: {
  notebook: Notebook;
  agentId: string;
  open: boolean;
  onClose(): void;
  onError(message: string): void;
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [query, setQuery] = useState("");
  const [links, setLinks] = useState("");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const used = notebook.sources.length;
  const close = () => {
    setMode("choose");
    setLinks("");
    setTitle("");
    setPasted("");
    onClose();
  };
  const report = (failed: string[] | string | null | undefined) => {
    const list = Array.isArray(failed) ? failed : failed ? [failed] : [];
    if (list.length) onError(list.join(" "));
  };
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    work()
      .then(() => close())
      .catch((reason: unknown) =>
        onError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setBusy(false));
  };

  const research = (event?: FormEvent) => {
    event?.preventDefault();
    const topic = query.trim();
    if (!topic) return;
    setQuery("");
    const have = notebook.sources.flatMap((source) => (source.url ? [source.url] : []));
    run(() =>
      startJob({
        kind: "research",
        title: jobTitle("research", topic),
        agentId,
        notebookId: notebook.id,
        prompt: researchPrompt(topic, have),
      }),
    );
  };
  const addLinks = () => {
    const addresses = links
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\//i.test(item));
    if (!addresses.length)
      return onError("Paste one or more web addresses, starting with https://.");
    // Each link is kept now; its text arrives as Misty reads it.
    for (const address of addresses) void addLink(notebook.id, address).then(report);
    close();
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length) run(() => addDroppedFiles(notebook.id, files).then(report));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        aria-describedby={undefined}
        className="tutor-add-dialog"
        data-dragging={dragging ? "true" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <DialogTitle className="tutor-add-title">Add sources</DialogTitle>
        <form className="tutor-research tutor-research-large" onSubmit={research}>
          <Globe size={16} aria-hidden="true" />
          <Input
            variant="toolbar"
            aria-label="Search the web for new sources"
            placeholder="Search the web for new sources"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton label="Find sources" type="submit" disabled={!query.trim() || busy}>
            <ArrowRight />
          </IconButton>
        </form>

        {mode === "links" ? (
          <div className="tutor-card-form">
            <Textarea
              autoFocus
              rows={4}
              aria-label="Web addresses"
              placeholder="Paste web pages, PDFs or YouTube videos, one per line"
              value={links}
              onChange={(event) => setLinks(event.target.value)}
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="quiet" onClick={() => setMode("choose")}>
                Back
              </Button>
              <Button disabled={!links.trim()} onClick={addLinks}>
                Add
              </Button>
            </div>
          </div>
        ) : mode === "text" ? (
          <div className="tutor-card-form">
            <Input
              autoFocus
              aria-label="Title"
              placeholder="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Textarea
              rows={8}
              aria-label="Text"
              placeholder="Paste the text"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="quiet" onClick={() => setMode("choose")}>
                Back
              </Button>
              <Button
                disabled={!pasted.trim()}
                onClick={() => {
                  addText(notebook.id, title.trim() || "Pasted text", pasted);
                  close();
                }}
              >
                Add
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="tutor-add-kinds">
              <Button
                disabled={busy}
                size="lg"
                onClick={() => run(() => addPickedFiles(notebook.id))}
                icon={Upload}
              >
                Upload files
              </Button>
              <Button
                disabled={busy}
                size="lg"
                onClick={() => run(() => addRecordings(notebook.id).then(report))}
                icon={Mic}
              >
                Recordings
              </Button>
              <Button size="lg" onClick={() => setMode("links")} icon={Link2}>
                Websites and videos
              </Button>
              <Button size="lg" onClick={() => setMode("text")} icon={Clipboard}>
                Copied text
              </Button>
            </div>
            <div className="tutor-drop" aria-hidden={busy}>
              <Upload size={22} aria-hidden="true" />
              <p className={busy ? "misty-shimmer" : undefined}>
                {busy ? "Reading" : "Drop files here: PDF, Word, PowerPoint, Excel, text and more."}
              </p>
            </div>
          </>
        )}

        <div className="tutor-add-limit">
          <Progress value={(used / sourceLimit) * 100} aria-label="Sources in this notebook" />
          <span className="tutor-card-detail">
            {used} / {sourceLimit}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
