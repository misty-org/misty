import type { GlobalPreviewKind } from "@/models/types/features/explorer/components/GlobalPreview";
export type { GlobalPreviewKind } from "@/models/types/features/explorer/components/GlobalPreview";
import type {
  GlobalPreviewSource,
  PreviewResource,
} from "@/models/interfaces/features/explorer/components/GlobalPreview";
export type {
  GlobalPreviewSource,
  PreviewResource,
} from "@/models/interfaces/features/explorer/components/GlobalPreview";
import { Textarea } from "@/ui";
import { Button } from "@/ui";
import { Dialog, DialogContent, DialogTitle } from "@/ui";
import { Copy, ExternalLink, FileArchive, FileQuestion, Loader2, Save, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  archiveList,
  explorerOpenPath,
  explorerPrepareOpenItem,
  explorerPreviewItem,
  explorerSavePreviewItem,
  fetchPreviewBytes,
} from "@/stores/backend";
import type { ArchiveEntry } from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { GlobalImageEditor } from "../../editor/GlobalImageEditor";

const ReactMarkdown = lazy(() => import("react-markdown"));
const textExtensions = new Set([
  "txt",
  "text",
  "log",
  "md",
  "markdown",
  "toml",
  "yaml",
  "yml",
  "ini",
  "conf",
  "cfg",
  "csv",
  "tsv",
  "rs",
  "go",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "html",
  "xml",
  "sh",
  "zsh",
  "bash",
  "fish",
  "py",
  "rb",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "swift",
  "kt",
  "sql",
  "json",
  "jsonc",
]);
const officeExtensions = new Set([
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "epub",
  "rtf",
  "doc",
  "xls",
  "ppt",
]);
const archiveExtensions = new Set([
  "zip",
  "tar",
  "tgz",
  "gz",
  "tbz",
  "tbz2",
  "bz2",
  "txz",
  "xz",
  "7z",
  "rar",
]);
const imageMimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  tga: "image/x-tga",
  psd: "image/vnd.adobe.photoshop",
  pnm: "image/x-portable-anymap",
  ppm: "image/x-portable-pixmap",
  pgm: "image/x-portable-graymap",
};
const videoMimeTypes: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
};
const audioMimeTypes: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  wma: "audio/x-ms-wma",
};
export function GlobalPreviewDialog(props: {
  source: GlobalPreviewSource;
  onClose: () => void;
  onSaved?: (path: string, copy: boolean) => void | Promise<void>;
  onSaveMetadata?: (caption: string, tags: string[]) => void | Promise<void>;
}) {
  const { resource, loading, loadError, reload } = useGlobalPreviewResource(props.source);
  const extension = sourceExtension(props.source);
  const [textDraft, setTextDraft] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [saving, setSaving] = useState<"save" | "copy" | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSaveStatus(null);
    setSaveError(null);
  }, [props.source.path]);
  useEffect(() => {
    if (resource?.text !== undefined) setTextDraft(resource.text);
  }, [resource?.text]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const textDirty = Boolean(
    resource &&
    (resource.kind === "text" || resource.kind === "markdown") &&
    textDraft !== resource.text,
  );
  const imageEditorMode =
    globalPreviewKindForSource(extension, props.source.mimeType ?? undefined) === "image";
  const canEditText = Boolean(
    resource && (resource.kind === "text" || resource.kind === "markdown") && !props.source.remote,
  );
  const dirty = textDirty;

  const save = async (copy: boolean) => {
    if (!resource || saving || props.source.remote) return;
    setSaving(copy ? "copy" : "save");
    setSaveError(null);
    setSaveStatus(null);
    try {
      let bytes: number[];
      if (resource.kind === "text" || resource.kind === "markdown") {
        bytes = [...new TextEncoder().encode(textDraft)];
      } else {
        return;
      }
      const result = await explorerSavePreviewItem({
        path: props.source.path,
        bytes,
        saveAsCopy: copy,
      });
      const savedPath = result.affectedPaths[0] ?? props.source.path;
      setSaveStatus(copy ? `Saved copy as ${fileName(savedPath)}` : "Saved");
      if (!copy) {
        resource.text = textDraft;
        setEditingText(false);
      }
      await props.onSaved?.(savedPath, copy);
    } catch (reason) {
      setSaveError(errorText(reason));
    } finally {
      setSaving(null);
    }
  };

  const saveImageBlob = async (blob: Blob, copy: boolean) => {
    const bytes = [...new Uint8Array(await blob.arrayBuffer())];
    const result = await explorerSavePreviewItem({
      path: props.source.path,
      bytes,
      saveAsCopy: copy,
    });
    const savedPath = result.affectedPaths[0] ?? props.source.path;
    if (!copy) await reload();
    await props.onSaved?.(savedPath, copy);
  };

  if (imageEditorMode)
    return (
      <GlobalImageEditor
        sourceKey={props.source.path}
        name={props.source.name}
        url={resource?.url ?? ""}
        tags={props.source.tags}
        outputMimeType={imageOutputMimeType(extension)}
        loading={loading}
        error={loadError ?? undefined}
        readonly={props.source.readonly || props.source.remote}
        onClose={props.onClose}
        onSave={async (_edit, blob) => saveImageBlob(blob, false)}
        onSaveAsCopy={async (_edit, blob) => saveImageBlob(blob, true)}
        onSaveTags={
          props.onSaveMetadata
            ? async (nextTags) => props.onSaveMetadata?.(props.source.description ?? "", nextTags)
            : undefined
        }
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="left-0 top-0 block h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none bg-background p-0 text-foreground shadow-none ring-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 [&>[data-slot=dialog-close]]:hidden"
      >
        <section className="grid h-full min-h-0 grid-rows-[58px_minmax(0,1fr)]">
          <header className="grid min-w-0 grid-cols-[minmax(180px,1fr)_auto_minmax(180px,1fr)] items-center gap-3 border-b border-border px-4">
            <div className="min-w-0">
              <DialogTitle className="m-0 truncate text-sm font-semibold">
                {props.source.name}
              </DialogTitle>
              <span className="block truncate text-[11px] text-muted-foreground">
                {friendlyType(extension, props.source.mimeType)}
              </span>
            </div>
            <span />
            <div className="flex min-w-0 justify-end gap-2">
              {canEditText ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!dirty || Boolean(saving)}
                    onClick={() => void save(true)}
                  >
                    {saving === "copy" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    Save as Copy
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty || props.source.readonly || Boolean(saving)}
                    onClick={() => void save(false)}
                  >
                    {saving === "save" ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    Save
                  </Button>
                </>
              ) : null}
              <ToolbarButton label="Close preview" onClick={props.onClose}>
                <X size={18} />
              </ToolbarButton>
            </div>
          </header>
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] max-[820px]:grid-cols-1">
            <main className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
              {canEditText ? (
                <div className="flex min-h-12 items-center justify-center border-b border-border bg-muted/30 px-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingText((value) => !value)}
                  >
                    {editingText ? "Preview" : "Edit text"}
                  </Button>
                </div>
              ) : (
                <div />
              )}
              <div className="min-h-0 overflow-auto">
                {loading ? (
                  <PreviewMessage
                    icon={<Loader2 className="animate-spin" size={28} />}
                    title="Preparing preview"
                    detail="Loading the best available reader…"
                  />
                ) : null}
                {!loading && loadError ? (
                  <PreviewMessage
                    icon={<FileQuestion size={34} />}
                    title="Preview needs attention"
                    detail={loadError}
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void explorerOpenPath(props.source.path)}
                      >
                        <ExternalLink size={14} />
                        Open in default app
                      </Button>
                    }
                  />
                ) : null}
                {!loading && resource ? (
                  <PreviewBody
                    resource={resource}
                    source={props.source}
                    extension={extension}
                    textDraft={textDraft}
                    editingText={editingText}
                    onTextChange={(value) => {
                      setTextDraft(value);
                      setSaveStatus(null);
                    }}
                  />
                ) : null}
              </div>
            </main>
            <aside className="min-h-0 overflow-y-auto border-l border-border bg-card p-5 max-[820px]:hidden">
              <div className="grid gap-5">
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Inspector
                  </span>
                  <h2 className="m-0 mt-2 break-words text-lg font-semibold">
                    {props.source.name}
                  </h2>
                </div>
                <dl className="m-0 grid gap-4">
                  <InspectorDetail
                    label="Kind"
                    value={friendlyType(extension, resource?.mimeType ?? props.source.mimeType)}
                  />
                  <InspectorDetail
                    label="Size"
                    value={
                      props.source.sizeBytes == null ? "—" : formatBytes(props.source.sizeBytes)
                    }
                  />
                  <InspectorDetail label="Modified" value={formatDate(props.source.modifiedMs)} />
                  {props.source.createdMs != null ? (
                    <InspectorDetail label="Created" value={formatDate(props.source.createdMs)} />
                  ) : null}
                  <InspectorDetail label="Path" value={props.source.path} />
                </dl>
                {props.source.description ? (
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Description
                    </span>
                    <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                      {props.source.description}
                    </p>
                  </div>
                ) : null}
                {saveStatus || saveError ? (
                  <p
                    className={`m-0 rounded-lg px-3 py-2 text-xs ${saveError ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}
                    role="status"
                  >
                    {saveError ?? saveStatus}
                  </p>
                ) : null}
                {props.source.remote ? (
                  <p className="m-0 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                    Remote previews are read-only. Download the file to edit it.
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody(props: {
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
  if (resource.kind === "video")
    return (
      <div className="grid h-full min-h-[360px] place-items-center p-5">
        <video
          className="max-h-full max-w-full"
          src={resource.url}
          controls
          autoPlay
          muted
          playsInline
          preload="metadata"
        />
      </div>
    );
  if (resource.kind === "audio")
    return (
      <div className="grid h-full min-h-[360px] place-items-center p-5">
        <div className="grid w-[min(520px,90%)] justify-items-center gap-6 rounded-xl bg-card p-10 shadow-xs ring-1 ring-foreground/10">
          <span className="grid size-20 place-items-center rounded-full bg-muted text-muted-foreground">
            ♫
          </span>
          <strong className="text-center">{props.source.name}</strong>
          <audio className="w-full" src={resource.url} controls autoPlay preload="metadata" />
        </div>
      </div>
    );
  if (resource.kind === "pdf")
    return (
      <object
        className="h-full min-h-[620px] w-full bg-white"
        data={resource.url}
        type="application/pdf"
        aria-label={`PDF reader for ${props.source.name}`}
      />
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

export function EmbeddedUniversalPreview(props: {
  name: string;
  mimeType: string;
  url: string;
  loading?: boolean;
  error?: string;
  imageRef?: React.RefObject<HTMLImageElement>;
  videoRef?: React.RefObject<HTMLVideoElement>;
  mediaStyle?: React.CSSProperties;
  autoPlay?: boolean;
  loop?: boolean;
  onVideoEnded?: () => void;
  onVideoMetadata?: () => void;
  onVideoTime?: () => void;
  fallbackAction?: React.ReactNode;
}) {
  const extension = sourceExtension({ path: "", name: props.name });
  const isImage = props.mimeType.startsWith("image/") || Boolean(imageMimeTypes[extension]);
  const isVideo = props.mimeType.startsWith("video/") || Boolean(videoMimeTypes[extension]);
  const isAudio = props.mimeType.startsWith("audio/") || Boolean(audioMimeTypes[extension]);
  const isPdf = props.mimeType === "application/pdf" || extension === "pdf";
  const isReadableDocument = textExtensions.has(extension) || officeExtensions.has(extension);
  const {
    resource,
    loading: documentLoading,
    error: documentError,
  } = useEmbeddedDocument(props.url, extension, props.mimeType, isReadableDocument);
  if (props.loading || documentLoading)
    return (
      <PreviewMessage
        icon={<Loader2 className="animate-spin" size={28} />}
        title="Preparing preview"
        detail="Loading the best available reader…"
      />
    );
  if (props.error || documentError)
    return (
      <PreviewMessage
        icon={<FileQuestion size={34} />}
        title="Preview needs attention"
        detail={props.error || documentError || "The file could not be read."}
        action={props.fallbackAction}
      />
    );
  if (isImage && props.url)
    return (
      <img
        ref={props.imageRef}
        className="block max-h-full max-w-full object-contain transition-[filter,transform]"
        style={props.mediaStyle}
        src={props.url}
        alt={props.name}
      />
    );
  if (isVideo && props.url)
    return (
      <video
        ref={props.videoRef}
        className="block max-h-full max-w-full object-contain transition-[filter,transform]"
        style={props.mediaStyle}
        src={props.url}
        controls
        autoPlay={props.autoPlay}
        loop={props.loop}
        onEnded={props.onVideoEnded}
        onLoadedMetadata={props.onVideoMetadata}
        onTimeUpdate={props.onVideoTime}
      />
    );
  if (isAudio && props.url)
    return (
      <div className="grid w-[min(520px,90%)] justify-items-center gap-5 rounded-xl bg-card p-8 text-center shadow-xs ring-1 ring-foreground/10">
        <span className="text-5xl text-muted-foreground">♫</span>
        <strong>{props.name}</strong>
        <audio className="w-full" src={props.url} controls />
      </div>
    );
  if (isPdf && props.url)
    return (
      <object
        className="h-full min-h-[520px] w-full bg-white"
        data={props.url}
        type="application/pdf"
        aria-label={`PDF reader for ${props.name}`}
      />
    );
  if (resource?.kind === "markdown")
    return (
      <article className="prose dark:prose-invert mx-auto h-full w-full max-w-4xl overflow-auto px-8 py-10">
        <Suspense fallback={<span>Rendering Markdown…</span>}>
          <ReactMarkdown>{resource.text ?? ""}</ReactMarkdown>
        </Suspense>
      </article>
    );
  if (resource?.kind === "text")
    return (
      <pre className="m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-7 text-left font-mono text-[13px] leading-6 text-foreground/80">
        {resource.text}
      </pre>
    );
  if (resource?.kind === "document")
    return (
      <article className="mx-auto h-full w-full max-w-4xl overflow-auto whitespace-pre-wrap px-10 py-12 text-left font-serif text-[16px] leading-8 text-foreground/80">
        {resource.text || "This document contains no readable text."}
      </article>
    );
  return (
    <PreviewMessage
      icon={<FileQuestion size={40} />}
      title={`${friendlyType(extension, props.mimeType)} file`}
      detail="Misty can inspect this file and make the original available to you."
      action={props.fallbackAction}
    />
  );
}

function useEmbeddedDocument(url: string, extension: string, mimeType: string, enabled: boolean) {
  const [resource, setResource] = useState<PreviewResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setResource(null);
    setError("");
    if (!enabled || !url) {
      setLoading(false);
      return () => undefined;
    }
    setLoading(true);
    void fetchPreviewBytes(url)
      .then(async (buffer) => {
        const bytes = new Uint8Array(buffer);
        if (officeExtensions.has(extension))
          return {
            kind: "document" as const,
            text: await extractDocumentText(extension, bytes),
            mimeType,
          };
        const text = new TextDecoder().decode(bytes);
        return {
          kind:
            extension === "md" || extension === "markdown"
              ? ("markdown" as const)
              : ("text" as const),
          text,
          mimeType,
        };
      })
      .then((next) => {
        if (active) setResource(next);
      })
      .catch((reason) => {
        if (active) setError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, extension, mimeType, url]);
  return { resource, loading, error };
}

function ArchiveReader(props: { entries: ArchiveEntry[]; format: string }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-2 p-8">
      <div className="mb-3 flex items-center gap-3">
        <FileArchive size={26} />
        <div>
          <strong className="block">{props.format.toUpperCase()} archive</strong>
          <span className="text-xs text-muted-foreground">
            {props.entries.length} visible entries
          </span>
        </div>
      </div>
      {props.entries.map((entry, index) => (
        <div
          key={`${entry.path}:${index}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <span className="truncate">{entry.path}</span>
          <span className="text-muted-foreground">
            {entry.isDir ? "Folder" : formatBytes(entry.uncompressedSize)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PreviewMessage(props: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center p-8 text-center">
      <div className="grid max-w-md justify-items-center gap-3 text-muted-foreground">
        {props.icon}
        <strong className="text-base text-foreground">{props.title}</strong>
        <p className="m-0 text-sm leading-6">{props.detail}</p>
        {props.action}
      </div>
    </div>
  );
}

function ToolbarButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

function InspectorDetail(props: { label: string; value: string; compact?: boolean }) {
  if (props.compact)
    return (
      <div>
        <dt className="text-[10px] font-medium text-muted-foreground">{props.label}</dt>
        <dd className="m-0 mt-0.5 break-words text-[11px] leading-4 text-foreground/80">
          {props.value}
        </dd>
      </div>
    );
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {props.label}
      </dt>
      <dd className="m-0 mt-1 break-words text-sm leading-5 text-foreground/80">{props.value}</dd>
    </div>
  );
}

function useGlobalPreviewResource(source: GlobalPreviewSource) {
  const [resource, setResource] = useState<PreviewResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(async () => {
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setLoading(true);
    setLoadError(null);
    setResource(null);
    void loadGlobalPreview(source)
      .then((loaded) => {
        if (!active) return;
        objectUrl = loaded.url?.startsWith("blob:") ? loaded.url : undefined;
        setResource(loaded);
      })
      .catch((reason) => {
        if (active) setLoadError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [revision, source.path, source.modifiedMs, source.sizeBytes]);
  return { resource, loading, loadError, reload };
}

async function loadGlobalPreview(source: GlobalPreviewSource): Promise<PreviewResource> {
  const extension = sourceExtension(source);
  const mimeType =
    source.mimeType ||
    imageMimeTypes[extension] ||
    videoMimeTypes[extension] ||
    audioMimeTypes[extension] ||
    "application/octet-stream";
  const kind = globalPreviewKindForSource(extension, mimeType);
  const preparedPath = source.remote
    ? (
        await explorerPrepareOpenItem({
          path: source.path,
          sizeBytes: source.sizeBytes ?? null,
          remoteModified: null,
        })
      ).localPath
    : source.path;
  if (kind === "video") return { kind, url: safeTauriAssetUrl(preparedPath), mimeType };
  if (kind === "audio") return { kind, url: safeTauriAssetUrl(preparedPath), mimeType };
  if (kind === "archive") {
    const archive = await archiveList({ path: preparedPath });
    return {
      kind: "archive",
      mimeType: "application/vnd.misty.archive-list",
      archiveEntries: archive.entries.slice(0, 500),
      archiveFormat: archive.format,
    };
  }
  if (kind === "image") return { kind, url: safeTauriAssetUrl(preparedPath), mimeType };
  const payload = await explorerPreviewItem(preparedPath);
  const bytes = new Uint8Array(payload.bytes);
  if (kind === "pdf" || payload.mimeType === "application/pdf")
    return {
      kind: "pdf",
      url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
      mimeType: "application/pdf",
    };
  if (
    kind === "markdown" ||
    kind === "text" ||
    payload.mimeType.startsWith("text/") ||
    payload.mimeType.includes("json")
  ) {
    const text = new TextDecoder().decode(bytes);
    return { kind: kind === "markdown" ? "markdown" : "text", text, mimeType: payload.mimeType };
  }
  if (kind === "document")
    return { kind, text: await extractDocumentText(extension, bytes), mimeType: payload.mimeType };
  return { kind: "generic", mimeType: payload.mimeType };
}

export function globalPreviewKindForSource(extension: string, mimeType = ""): GlobalPreviewKind {
  const normalizedExtension = extension.replace(/^\./, "").toLocaleLowerCase();
  const normalizedMimeType = mimeType.split(";")[0].trim().toLocaleLowerCase();
  if (videoMimeTypes[normalizedExtension] || normalizedMimeType.startsWith("video/"))
    return "video";
  if (audioMimeTypes[normalizedExtension] || normalizedMimeType.startsWith("audio/"))
    return "audio";
  if (archiveExtensions.has(normalizedExtension)) return "archive";
  if (imageMimeTypes[normalizedExtension] || normalizedMimeType.startsWith("image/"))
    return "image";
  if (normalizedExtension === "pdf" || normalizedMimeType === "application/pdf") return "pdf";
  if (normalizedExtension === "md" || normalizedExtension === "markdown") return "markdown";
  if (
    textExtensions.has(normalizedExtension) ||
    normalizedMimeType.startsWith("text/") ||
    normalizedMimeType.includes("json")
  )
    return "text";
  if (officeExtensions.has(normalizedExtension)) return "document";
  return "generic";
}

async function extractDocumentText(extension: string, bytes: Uint8Array): Promise<string> {
  if (extension === "docx") {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    });
    return result.value.trim();
  }
  if (extension === "rtf") return rtfToText(new TextDecoder("latin1").decode(bytes));
  if (extension === "doc" || extension === "xls" || extension === "ppt")
    return "This legacy Office file can be opened in its default application. Save it as DOCX, XLSX, or PPTX for an inline text reader.";
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => documentXmlFile(extension, name))
    .sort(naturalPathSort);
  const chunks: string[] = [];
  for (const name of names.slice(0, 300)) {
    const xml = await zip.files[name].async("text");
    const text = xmlToText(xml);
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}

function documentXmlFile(extension: string, name: string): boolean {
  if (extension === "pptx") return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
  if (extension === "xlsx") return /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/i.test(name);
  if (extension === "epub") return /\.(xhtml|html|htm)$/i.test(name);
  return name === "content.xml";
}

function xmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/(?:w:p|a:p|text:p|text:h|tr|row|div|p|h[1-6])>/gi, "\n")
      .replace(/<\/(?:w:tab|tab|td|c)>/gi, "\t")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function rtfToText(value: string): string {
  return value
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function naturalPathSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

function imageOutputMimeType(extension: string): string {
  return extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "webp"
      ? "image/webp"
      : "image/png";
}
function sourceExtension(source: GlobalPreviewSource): string {
  return (source.extension || source.name.split(".").pop() || "").replace(/^\./, "").toLowerCase();
}
function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}
function friendlyType(extension: string, mimeType?: string | null): string {
  return extension
    ? `${extension.toUpperCase()} ${typeFamily(extension, mimeType)}`
    : mimeType || "File";
}
function typeFamily(extension: string, mimeType?: string | null): string {
  if (imageMimeTypes[extension] || mimeType?.startsWith("image/")) return "image";
  if (videoMimeTypes[extension] || mimeType?.startsWith("video/")) return "video";
  if (audioMimeTypes[extension] || mimeType?.startsWith("audio/")) return "audio";
  if (extension === "pdf" || officeExtensions.has(extension)) return "document";
  if (textExtensions.has(extension)) return "text";
  if (archiveExtensions.has(extension)) return "archive";
  return "file";
}
