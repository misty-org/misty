import { TourCorner } from "../../TourCorner";
import { useState, type FormEvent } from "react";
import { useFileDropZone } from "@/shared/hooks/useFileDropZone";
import { ArrowRight, Clipboard, Globe, Link2, Mic, Upload } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Input,
  PlaceholderIcon,
  Progress,
  Surface,
  Text,
  Textarea,
} from "@/shared/ui";
import { useLabKeys } from "../labKeys";
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
 * Recordings are transcribed on the person's Soniox key, so they're offered only once it's saved.
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
  const [busy, setBusy] = useState(false);
  const keys = useLabKeys();
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
  // Files dropped from the computer's file manager, on every desktop system and in a browser.
  const dropZone = useFileDropZone<HTMLDivElement>(
    (files) => {
      if (files.length) run(() => addDroppedFiles(notebook.id, files).then(report));
    },
    { onError },
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        aria-describedby={undefined}
        className="w-180 max-w-[calc(100vw-3rem)] gap-4.5 p-7"
        ref={dropZone.ref}
        data-dragging={dropZone.dragging ? "true" : undefined}
        {...dropZone.handlers}
      >
        {/* Files dragged over the dialog land anywhere on it. */}
        {dropZone.dragging ? (
          <Surface
            tone="none"
            edge="dashed"
            radius="lg"
            className="pointer-events-none absolute inset-2 border-2"
            aria-hidden="true"
          />
        ) : null}
        <DialogTitle className="text-center text-display">Add sources</DialogTitle>
        <Surface
          as="form"
          tone="page"
          edge="field"
          radius="xl"
          className="flex items-center gap-1.5 p-1.5 pl-3.5"
          onSubmit={research}
          data-tour="sources-research"
        >
          <Text bare tone="muted" className="inline-flex flex-none">
            <Globe aria-hidden="true" />
          </Text>
          <Input
            variant="bare"
            className="h-9.5 flex-1 px-2"
            aria-label="Search the web for new sources"
            placeholder="Search the web for new sources"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton label="Find sources" type="submit" disabled={!query.trim() || busy}>
            <ArrowRight />
          </IconButton>
        </Surface>

        {mode === "links" ? (
          <div className="flex flex-col gap-2">
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
          <div className="flex flex-col gap-2">
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
            <div className="flex flex-wrap justify-center gap-2" data-tour="sources-kinds">
              <Button
                disabled={busy}
                size="lg"
                onClick={() => run(() => addPickedFiles(notebook.id))}
                icon={Upload}
              >
                Upload files
              </Button>
              {keys.recordings ? (
                <Button
                  disabled={busy}
                  size="lg"
                  onClick={() => run(() => addRecordings(notebook.id).then(report))}
                  icon={Mic}
                >
                  Recordings
                </Button>
              ) : null}
              <Button size="lg" onClick={() => setMode("links")} icon={Link2}>
                Websites and videos
              </Button>
              <Button size="lg" onClick={() => setMode("text")} icon={Clipboard}>
                Copied text
              </Button>
            </div>
            <Surface
              tone="none"
              edge="dashed"
              radius="xl"
              className="px-5 py-8.5 text-center"
              aria-hidden={busy}
              data-tour="sources-drop"
            >
              <Text as="div" bare tone="muted" className="flex flex-col items-center gap-2">
                <PlaceholderIcon icon={Upload} />
                <p className={busy ? "misty-shimmer text-meta" : "text-meta"}>
                  {busy
                    ? "Reading"
                    : "Drop files here: PDF, Word, PowerPoint, Excel, text and more."}
                </p>
              </Text>
            </Surface>
          </>
        )}

        {/* Clear of the tour button in the dialog's corner. */}
        <div
          className="flex items-center gap-3 pr-8 [&>:first-child]:flex-1"
          data-tour="sources-limit"
        >
          <Progress value={(used / sourceLimit) * 100} aria-label="Sources in this notebook" />
          <Text bare size="caption" tone="muted" className="flex-none">
            {used} / {sourceLimit}
          </Text>
        </div>
        <TourCorner tour="add-sources" />
      </DialogContent>
    </Dialog>
  );
}
