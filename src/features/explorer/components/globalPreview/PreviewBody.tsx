import type {
  GlobalPreviewSource,
  PreviewResource,
} from "@/models/interfaces/features/explorer/components/GlobalPreview";
import { Textarea } from "@/ui";
import { Button } from "@/ui";
import { ExternalLink, FileQuestion } from "lucide-react";
import { lazy, Suspense } from "react";
import { explorerOpenPath } from "@/stores/backend";
import { friendlyType } from "./previewFormat";
import { ArchiveReader, PreviewMessage } from "./previewPrimitives";

const ReactMarkdown = lazy(() => import("react-markdown"));
const PdfViewer = lazy(() => import("../PdfViewer"));
const VideoAnnotator = lazy(() => import("../VideoAnnotator"));

export function PreviewBody(props: {
  resource: PreviewResource;
  source: GlobalPreviewSource;
  extension: string;
  textDraft: string;
  editingText: boolean;
  onTextChange: (value: string) => void;
}) {
  const { resource } = props;
  if (resource.kind === "image" && resource.url)
    return (
      <div className="grid h-full min-h-[360px] place-items-center p-5">
        <img
          className="max-h-full max-w-full object-contain shadow-2xl"
          src={resource.url}
          alt={props.source.name}
        />
      </div>
    );
  if (resource.kind === "video" && resource.url)
    return (
      <Suspense fallback={<div className="h-full min-h-[360px] w-full bg-black" />}>
        <VideoAnnotator
          url={resource.url}
          name={props.source.name}
          persistKey={props.source.path}
        />
      </Suspense>
    );
  if (resource.kind === "audio")
    return (
      <div className="grid h-full min-h-[360px] place-items-center p-5">
        <div className="grid w-[min(520px,90%)] justify-items-center gap-6 rounded-xl bg-card p-10 shadow-xs inset-ring-1 inset-ring-foreground/10">
          <span className="grid size-20 place-items-center rounded-full bg-muted text-muted-foreground">
            ♫
          </span>
          <strong className="text-center">{props.source.name}</strong>
          <audio className="w-full" src={resource.url} controls autoPlay preload="metadata" />
        </div>
      </div>
    );
  if (resource.kind === "pdf" && resource.url)
    return (
      <Suspense fallback={<div className="h-full min-h-[620px] w-full bg-neutral-800" />}>
        <PdfViewer url={resource.url} name={props.source.name} />
      </Suspense>
    );
  if (resource.kind === "archive")
    return (
      <ArchiveReader
        entries={resource.archiveEntries ?? []}
        format={resource.archiveFormat ?? props.extension}
      />
    );
  if ((resource.kind === "markdown" || resource.kind === "text") && props.editingText)
    return (
      <Textarea
        autoFocus
        className="h-full min-h-[620px] w-full resize-none rounded-none border-0 bg-background p-6 font-mono text-[13px] leading-6"
        value={props.textDraft}
        onChange={(event) => props.onTextChange(event.target.value)}
      />
    );
  if (resource.kind === "markdown")
    return (
      <article className="prose dark:prose-invert mx-auto max-w-4xl px-8 py-10">
        <Suspense fallback={<span>Rendering Markdown…</span>}>
          <ReactMarkdown>{props.textDraft}</ReactMarkdown>
        </Suspense>
      </article>
    );
  if (resource.kind === "text")
    return (
      <pre className="m-0 min-h-full whitespace-pre-wrap break-words p-7 font-mono text-[13px] leading-6 text-foreground/80">
        {props.textDraft}
      </pre>
    );
  if (resource.kind === "document")
    return (
      <article className="mx-auto max-w-4xl whitespace-pre-wrap px-10 py-12 font-serif text-[16px] leading-8 text-foreground/80">
        {resource.text || "This document contains no readable text."}
      </article>
    );
  return (
    <PreviewMessage
      icon={<FileQuestion size={40} />}
      title={`${friendlyType(props.extension, props.source.mimeType)} file`}
      detail="Misty can inspect this file and hand it to its default application."
      action={
        <Button size="sm" onClick={() => void explorerOpenPath(props.source.path)}>
          <ExternalLink size={14} />
          Open file
        </Button>
      }
    />
  );
}
