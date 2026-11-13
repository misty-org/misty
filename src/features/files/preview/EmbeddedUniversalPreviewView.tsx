import type { PreviewErrorComponent, PreviewResource } from "./previewTypes";
import { errorText } from "@/shared/lib/format";
import { FileQuestion } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { friendlyType, sourceExtension } from "./previewFormat";
import {
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./previewMediaTables";
import { PreviewMessage } from "./PreviewPrimitives";
import { cn, PlaceholderIcon, Skeleton, SkeletonDocument, Surface, Text } from "@/shared/ui";
import ReactMarkdown from "react-markdown";

const PdfViewer = lazy(() => import("./PdfViewerView"));

export function EmbeddedUniversalPreviewView(props: {
  runtime: EmbeddedPreviewRuntime;
  name: string;
  mimeType: string;
  url: string;
  loading?: boolean;
  error?: string;
  imageRef?: React.RefObject<HTMLImageElement | null>;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
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
  } = useEmbeddedDocument(
    props.url,
    extension,
    props.mimeType,
    isReadableDocument,
    props.runtime.readBytes,
    props.runtime.extractDocumentText,
  );
  if (props.loading || documentLoading)
    return (
      <PreviewSkeleton
        kind={isPdf ? "pdf" : isAudio ? "audio" : isImage || isVideo ? "media" : "document"}
      />
    );
  if (props.error || documentError)
    return (
      <>
        <props.runtime.Error
          error={props.error || documentError}
          scope="files:embedded-preview"
          title="File preview could not be loaded"
        />
        <PreviewMessage
          icon={<PlaceholderIcon icon={FileQuestion} />}
          title="Preview needs attention"
          detail="This file couldn't be previewed."
          action={props.fallbackAction}
        />
      </>
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
      <Surface
        tone="card"
        edge="hairline"
        radius="xl"
        className="grid w-[min(520px,90%)] justify-items-center gap-5 p-8 text-center shadow-xs"
      >
        <Text bare tone="muted" className="text-5xl">
          ♫
        </Text>
        <strong>{props.name}</strong>
        <audio className="w-full" src={props.url} controls />
      </Surface>
    );
  if (isPdf && props.url)
    return (
      <Suspense fallback={<Surface tone="card" className="h-full min-h-130 w-full" />}>
        <PdfViewer Error={props.runtime.Error} url={props.url} name={props.name} />
      </Suspense>
    );
  if (resource?.kind === "markdown")
    return (
      <article className="prose prose-invert mx-auto h-full w-full max-w-4xl overflow-auto px-8 py-10">
        <ReactMarkdown>{resource.text ?? ""}</ReactMarkdown>
      </article>
    );
  if (resource?.kind === "text")
    return (
      <pre className="m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-7 text-left font-mono text-ui leading-6">
        <Text bare tone="muted">
          {resource.text}
        </Text>
      </pre>
    );
  if (resource?.kind === "document")
    return (
      <article
        className={cn(
          "mx-auto h-full w-full max-w-4xl overflow-auto whitespace-pre-wrap px-10",
          "py-12 text-left text-base leading-8",
        )}
      >
        <Text bare tone="muted">
          {resource.text || "This document contains no readable text."}
        </Text>
      </article>
    );
  return (
    <PreviewMessage
      icon={<PlaceholderIcon icon={FileQuestion} />}
      title={`${friendlyType(extension, props.mimeType)} file`}
      detail="Misty can inspect this file and make the original available to you."
      action={props.fallbackAction}
    />
  );
}

function useEmbeddedDocument(
  url: string,
  extension: string,
  mimeType: string,
  enabled: boolean,
  readBytes: EmbeddedPreviewRuntime["readBytes"],
  extractDocumentText: EmbeddedPreviewRuntime["extractDocumentText"],
) {
  const [resource, setResource] = useState<PreviewResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const lifetime = new AbortController();
    setResource(null);
    setError("");
    if (!enabled || !url) {
      setLoading(false);
      return () => undefined;
    }
    setLoading(true);
    void readBytes(url, lifetime.signal)
      .then(async (buffer) => {
        const bytes = new Uint8Array(buffer);
        if (officeExtensions.has(extension)) {
          if (!extractDocumentText) throw new Error("The document reader is unavailable.");
          return {
            kind: "document" as const,
            text: await extractDocumentText(extension, bytes),
            mimeType,
          };
        }
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
      lifetime.abort();
    };
  }, [enabled, extension, mimeType, url, readBytes, extractDocumentText]);
  return { resource, loading, error };
}

interface EmbeddedPreviewRuntime {
  extractDocumentText?: (extension: string, bytes: Uint8Array) => Promise<string>;
  Error: PreviewErrorComponent;
  readBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
}

/**
 * The preview while its file loads, shaped like what it will show: a picture or video's frame,
 * the audio player's card, a PDF's first page, or a document's text.
 */
function PreviewSkeleton({ kind }: { kind: "media" | "audio" | "pdf" | "document" }) {
  if (kind === "document") return <SkeletonDocument label="Preview" />;
  return (
    <div
      role="status"
      aria-label="Preview"
      aria-busy="true"
      className="grid h-full w-full place-items-center"
    >
      <span className="sr-only">Preview</span>
      {kind === "media" ? (
        <Skeleton className="aspect-video max-h-full w-full max-w-3xl rounded-none" />
      ) : kind === "audio" ? (
        <Surface
          tone="card"
          edge="hairline"
          radius="xl"
          className="grid w-[min(520px,90%)] justify-items-center gap-5 p-8"
        >
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-full rounded-full" />
        </Surface>
      ) : (
        <Skeleton className="aspect-[8.5/11] w-[min(100%,640px)] self-start rounded-md" />
      )}
    </div>
  );
}
