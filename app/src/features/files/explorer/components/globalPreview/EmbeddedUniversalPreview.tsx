import { fetchPreviewBytes } from "@/api/preview/api";
import { errorText } from "@/shared/lib/format";
import { FileQuestion, Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { PreviewResource } from "../../model/interfaces/components/GlobalPreview";
import { friendlyType, sourceExtension } from "./previewFormat";
import {
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./previewMediaTables";
import { PreviewMessage } from "./previewPrimitives";
import { extractDocumentText } from "./useGlobalPreviewResource";

const ReactMarkdown = lazy(() => import("react-markdown"));
const PdfViewer = lazy(() => import("../PdfViewer"));

export function EmbeddedUniversalPreview(props: {
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
      <div className="grid w-[min(520px,90%)] justify-items-center gap-5 rounded-xl bg-charcoal-card p-8 text-center shadow-xs inset-ring-1 inset-ring-cream/10">
        <span className="text-5xl text-cream-muted">♫</span>
        <strong>{props.name}</strong>
        <audio className="w-full" src={props.url} controls />
      </div>
    );
  if (isPdf && props.url)
    return (
      <Suspense fallback={<div className="h-full min-h-[520px] w-full bg-charcoal-card" />}>
        <PdfViewer url={props.url} name={props.name} />
      </Suspense>
    );
  if (resource?.kind === "markdown")
    return (
      <article className="prose prose-invert mx-auto h-full w-full max-w-4xl overflow-auto px-8 py-10">
        <Suspense fallback={<span>Rendering Markdown…</span>}>
          <ReactMarkdown>{resource.text ?? ""}</ReactMarkdown>
        </Suspense>
      </article>
    );
  if (resource?.kind === "text")
    return (
      <pre className="m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words p-7 text-left font-mono text-[13px] leading-6 text-cream/80">
        {resource.text}
      </pre>
    );
  if (resource?.kind === "document")
    return (
      <article className="mx-auto h-full w-full max-w-4xl overflow-auto whitespace-pre-wrap px-10 py-12 text-left font-serif text-[16px] leading-8 text-cream/80">
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

export function useEmbeddedDocument(
  url: string,
  extension: string,
  mimeType: string,
  enabled: boolean,
) {
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
