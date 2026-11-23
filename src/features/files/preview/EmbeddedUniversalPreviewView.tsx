import type { PreviewErrorComponent, PreviewResource } from "./preview_types";
import { errorText } from "@/shared/lib/format";
import { FileQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { friendlyType, sourceExtension } from "./preview_format";
import {
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./preview_media_tables";
import { PreviewMessage } from "./PreviewPrimitives";
import { cn, PaneLoading, PlaceholderIcon, Surface, Text, lazyTool, ToolSuspense } from "@misty/ui";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { openExternalLink } from "@/shared/platform/open_external_link";

const PdfViewer = lazyTool(() => import("./PdfViewerView"));

const inlineImage = (url: string) => /^(?:data|blob):/i.test(url.trim());

function safeUrl(url: string, key: string): string {
  if (key === "src") return inlineImage(url) ? url : "";
  return defaultUrlTransform(url);
}

const markdownParts: Components = {
  img: ({ src, alt }) =>
    typeof src === "string" && inlineImage(src) ? <img src={src} alt={alt ?? ""} /> : null,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href && /^(?:https?:|mailto:)/i.test(href))
          void openExternalLink(href).catch(() => undefined);
      }}
    >
      {children}
    </a>
  ),
};

export interface PreviewText {
  text: string;
  truncated: boolean;
}

function StartOnly({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <Text size="meta" tone="muted" wrap className="pt-4">
      Showing the start of this file
    </Text>
  );
}

export function EmbeddedUniversalPreviewView(props: {
  runtime: EmbeddedPreviewRuntime;
  name: string;
  mimeType: string;
  url: string;
  placeholder?: string;
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
  text?: PreviewText;
  compact?: boolean;
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
    isReadableDocument && !props.text,
    props.runtime.readBytes,
    props.runtime.extractDocumentText,
  );
  if (props.loading || documentLoading) return <PaneLoading label="Loading preview" />;
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
  if (isImage && props.placeholder)
    return (
      <PreviewImage
        key={`${props.url}:${props.placeholder}`}
        name={props.name}
        url={props.url}
        placeholder={props.placeholder}
        imageRef={props.imageRef}
        mediaStyle={props.mediaStyle}
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
      <Surface
        tone="card"
        edge="hairline"
        radius="xl"
        className="grid w-[min(--spacing(130),90%)] justify-items-center gap-5 p-8 text-center shadow-xs"
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
      <ToolSuspense
        tool="PDF viewer"
        frame={(state) => (
          <Surface tone="card" className="h-full min-h-130 w-full">
            {state}
          </Surface>
        )}
      >
        <PdfViewer
          Error={props.runtime.Error}
          url={props.url}
          name={props.name}
          compact={props.compact}
        />
      </ToolSuspense>
    );
  const markdown = extension === "md" || extension === "markdown";
  const given = props.text;
  const shown =
    given && textExtensions.has(extension)
      ? { kind: markdown ? "markdown" : "text", text: given.text, truncated: given.truncated }
      : resource?.kind === "markdown" || resource?.kind === "text"
        ? { kind: resource.kind, text: resource.text ?? "", truncated: false }
        : null;
  if (shown?.kind === "markdown")
    return (
      <article className="prose prose-invert mx-auto h-full w-full max-w-4xl overflow-auto px-8 py-10">
        <ReactMarkdown urlTransform={safeUrl} components={markdownParts}>
          {shown.text}
        </ReactMarkdown>
        <StartOnly shown={shown.truncated} />
      </article>
    );
  if (shown?.kind === "text")
    return (
      <div className="h-full w-full overflow-auto p-7">
        <pre className="m-0 whitespace-pre-wrap break-words text-left font-mono text-ui leading-6">
          <Text bare tone="muted">
            {shown.text}
          </Text>
        </pre>
        <StartOnly shown={shown.truncated} />
      </div>
    );
  if (resource?.kind === "document")
    return (
      <article
        className={cn(
          "mx-auto h-full w-full max-w-4xl overflow-auto whitespace-pre-wrap px-10",
          "py-12 text-left text-body leading-8",
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

function PreviewImage(props: {
  name: string;
  url: string;
  placeholder: string;
  imageRef?: React.RefObject<HTMLImageElement | null>;
  mediaStyle?: React.CSSProperties;
}) {
  const [ready, setReady] = useState(false);
  const [placeholderShown, setPlaceholderShown] = useState(true);
  return (
    <div className="grid h-full w-full place-items-center">
      {!ready && placeholderShown ? (
        <img
          aria-hidden="true"
          alt=""
          src={props.placeholder}
          className="col-start-1 row-start-1 block h-full w-full object-contain"
          onError={() => setPlaceholderShown(false)}
        />
      ) : null}
      {props.url ? (
        <img
          ref={props.imageRef}
          className={cn(
            "col-start-1 row-start-1 block max-h-full max-w-full object-contain transition-[filter,transform]",
            !ready && "invisible",
          )}
          style={props.mediaStyle}
          src={props.url}
          alt={props.name}
          decoding="async"
          onLoad={(event) => {
            void event.currentTarget
              .decode()
              .catch(() => undefined)
              .finally(() => setReady(true));
          }}
          onError={() => setReady(true)}
        />
      ) : null}
    </div>
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
