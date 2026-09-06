import type { MailMessageBody } from "@/api/mail";
import type { InboxUiRuntime } from "../inboxUiRuntime";
import { Button, cn } from "@/shared/ui";
import { Code, Eye } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { InboxThread } from "../model";

export function linkifyEmailContent(content: string): string {
  if (!content) return "";
  return content.replace(/https?:\/\/[^\s<>"')]+/g, (url, offset: number, fullText: string) => {
    const prefix = fullText.slice(Math.max(0, offset - 2), offset);
    if (prefix.endsWith("](") || prefix.endsWith("<")) return url;
    return `[${url}](${url})`;
  });
}

export function EmailBodyView(props: {
  runtime: Pick<InboxUiRuntime, "openLink" | "report">;
  body?: MailMessageBody | null;
  snippet?: string;
}) {
  const { body, snippet = "" } = props;
  const rawHtml = body?.html?.trim();
  const rawText = body?.text?.trim() || snippet.trim();
  const hasHtml = Boolean(rawHtml);
  const [viewMode, setViewMode] = useState<"html" | "text">(() => (hasHtml ? "html" : "text"));

  useEffect(() => {
    setViewMode(hasHtml ? "html" : "text");
  }, [hasHtml]);

  if (!rawHtml && !rawText) return null;

  return (
    <div className="ml-[52px] mt-4 max-w-4xl max-[700px]:ml-0">
      {hasHtml && rawText ? (
        <div className="mb-3 flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant={viewMode === "html" ? "secondary" : "ghost"}
            size="xs"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => setViewMode("html")}
          >
            <Eye className="size-3" /> HTML
          </Button>
          <Button
            type="button"
            variant={viewMode === "text" ? "secondary" : "ghost"}
            size="xs"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => setViewMode("text")}
          >
            <Code className="size-3" /> Plain text
          </Button>
        </div>
      ) : null}

      {viewMode === "html" && rawHtml ? (
        <EmailHtmlFrameView runtime={props.runtime} html={rawHtml} />
      ) : (
        <EmailMarkdownView runtime={props.runtime} content={rawText} />
      )}
    </div>
  );
}

const heightCache = new Map<string, number>();
const documentCache = new Map<string, { source: string; prepared: string }>();
const pendingMeasurements = new Set<string>();
let measurementIframe: HTMLIFrameElement | null = null;

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

export function estimateEmailHeight(html: string): number {
  if (!html) return 200;
  let estimated = 60;

  const imageTagPattern = new RegExp("<" + "img[^>]*>", "gi");
  const imgMatches = html.match(imageTagPattern) || [];
  for (const imgTag of imgMatches) {
    const heightAttr = imgTag.match(/height=["']?(\d+)["']?/i);
    if (heightAttr && heightAttr[1]) {
      const h = parseInt(heightAttr[1], 10);
      if (!isNaN(h) && h > 0) {
        estimated += Math.min(h, 400);
        continue;
      }
    }
    estimated += 100;
  }

  const pCount = (html.match(/<p[^>]*>/gi) || []).length;
  estimated += pCount * 18;

  const hCount = (html.match(/<h[1-6][^>]*>/gi) || []).length;
  estimated += hCount * 24;

  const plainLength = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length;
  const textLines = Math.ceil(plainLength / 80);
  estimated += Math.min(textLines * 16, 600);

  return Math.min(Math.max(estimated, 120), 1200);
}

export function measureDocumentHeight(doc: Document): number {
  const body = doc.body;
  if (!body) return 120;

  let maxBottom = 0;
  const scanElements = (parent: Element, depth: number) => {
    if (depth > 4) return;
    for (let i = 0; i < parent.children.length; i++) {
      const el = parent.children[i] as HTMLElement;
      if (!el || el.nodeType !== 1) continue;
      const tag = el.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;

      const bottom = (el.offsetTop || 0) + (el.offsetHeight || 0);
      if (bottom > maxBottom) maxBottom = bottom;

      try {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > maxBottom) maxBottom = rect.bottom;
      } catch {
        // Ignore
      }

      if (el.children.length > 0 && depth < 3) {
        scanElements(el, depth + 1);
      }
    }
  };

  scanElements(body, 0);

  if (maxBottom > 30) {
    return Math.ceil(maxBottom + 24);
  }

  return Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, 100));
}

export function prefetchEmailHtml(html: string): void {
  if (!html) return;
  const contentKey = hashString(html);
  if (documentCache.get(contentKey)?.source !== html) {
    const prepared = prepareEmailDocument(html);
    if (documentCache.size > 250) documentCache.clear();
    documentCache.set(contentKey, { source: html, prepared });
  }
  if (!heightCache.has(contentKey)) {
    heightCache.set(contentKey, estimateEmailHeight(html));
  }

  if (typeof document === "undefined" || !document.body || pendingMeasurements.has(contentKey)) {
    return;
  }

  pendingMeasurements.add(contentKey);

  try {
    if (!measurementIframe) {
      measurementIframe = document.createElement("iframe");
      measurementIframe.setAttribute("sandbox", "allow-same-origin");
      measurementIframe.setAttribute("aria-hidden", "true");
      measurementIframe.setAttribute("tabindex", "-1");
      measurementIframe.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;width:720px;height:100px;visibility:hidden;pointer-events:none;border:0;opacity:0;z-index:-999;";
      document.body.appendChild(measurementIframe);
    }
    const cached = documentCache.get(contentKey);
    const prepared = cached?.source === html ? cached.prepared : prepareEmailDocument(html);
    measurementIframe.srcdoc = prepared;
    measurementIframe.onload = () => {
      pendingMeasurements.delete(contentKey);
      try {
        const doc = measurementIframe?.contentDocument;
        if (doc && doc.body) {
          const exact = measureDocumentHeight(doc);
          heightCache.set(contentKey, exact);
        }
      } catch {
        // Fallback to estimation
      }
    };
  } catch {
    pendingMeasurements.delete(contentKey);
  }
}

export function prefetchThreadHtml(thread: InboxThread): void {
  for (const message of thread.messages) {
    if (message.body?.html) {
      prefetchEmailHtml(message.body.html);
    }
  }
}

export function EmailHtmlFrameView(props: {
  runtime: Pick<InboxUiRuntime, "openLink" | "report">;
  html: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const contentKey = useMemo(() => hashString(props.html), [props.html]);
  const initialHeight = useMemo(() => {
    return heightCache.get(contentKey) ?? estimateEmailHeight(props.html);
  }, [contentKey, props.html]);

  const [height, setHeight] = useState(initialHeight);
  const [isReady, setIsReady] = useState(() => heightCache.has(contentKey));
  const instanceId = useId();

  const preparedHtml = useMemo(() => {
    const cached = documentCache.get(contentKey);
    if (cached?.source === props.html) return cached.prepared;
    const prepared = prepareEmailDocument(props.html);
    if (documentCache.size > 250) documentCache.clear();
    documentCache.set(contentKey, { source: props.html, prepared });
    return prepared;
  }, [props.html, contentKey]);

  const handleLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const doc = iframe.contentDocument;

    doc.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (anchor && anchor.href) {
        event.preventDefault();
        void props.runtime.openLink(anchor.href).catch((error) =>
          props.runtime.report({
            error,
            scope: "inbox:link",
            title: "Link could not be opened",
            target: { kind: "route", href: "/inbox" },
          }),
        );
      }
    });

    const updateHeight = () => {
      const currentDoc = iframeRef.current?.contentDocument;
      if (!currentDoc?.body) return;
      const nextHeight = measureDocumentHeight(currentDoc);
      setHeight(nextHeight);
      heightCache.set(contentKey, nextHeight);
      setIsReady(true);
    };

    updateHeight();

    const images = doc.querySelectorAll("img");
    images.forEach((img) => {
      if (!img.complete) {
        img.addEventListener("load", updateHeight, { once: true });
        img.addEventListener("error", updateHeight, { once: true });
      }
    });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(doc.body);
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-charcoal-border/70 bg-white shadow-sm transition-opacity duration-150",
        isReady ? "opacity-100" : "opacity-95",
      )}
    >
      <iframe
        key={instanceId}
        ref={iframeRef}
        srcDoc={preparedHtml}
        title="Email message body"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        loading="eager"
        className="w-full border-0 transition-[height] duration-200 ease-out"
        style={{ height: `${height}px`, minHeight: "80px", display: "block" }}
        onLoad={handleLoad}
      />
    </div>
  );
}

export function EmailMarkdownView(props: {
  runtime: Pick<InboxUiRuntime, "openLink" | "report">;
  content: string;
}) {
  const prepared = linkifyEmailContent(props.content);
  if (!prepared.trim()) return null;

  return (
    <div className="text-[13px] leading-6 text-cream-muted">
      <ReactMarkdown
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              onClick={(event) => {
                if (href) {
                  event.preventDefault();
                  void props.runtime.openLink(href).catch((error) =>
                    props.runtime.report({
                      error,
                      scope: "inbox:link",
                      title: "Link could not be opened",
                      target: { kind: "route", href: "/inbox" },
                    }),
                  );
                }
              }}
              className={cn(
                "text-cream-bright underline decoration-charcoal-border",
                "hover:decoration-cream-muted hover:text-cream-bright break-all",
              )}
              target="_blank"
              rel="noopener noreferrer"
              {...rest}
            >
              {children}
            </a>
          ),
          p: ({ children }) => (
            <p className="mb-3 whitespace-pre-wrap leading-6 text-cream-muted last:mb-0">
              {children}
            </p>
          ),
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-base font-semibold text-cream-bright first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-sm font-semibold text-cream-bright first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-3 text-sm font-medium text-cream-bright first:mt-0">
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc pl-5 space-y-1 text-cream-muted">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal pl-5 space-y-1 text-cream-muted">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-6">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-charcoal-border pl-3 text-cream-faint italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-charcoal-border" />,
          code: ({ children, className }) => (
            <code
              className={cn(
                "rounded bg-charcoal-card px-1.5 py-0.5 font-mono text-[12px] text-cream",
                className,
              )}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border border-charcoal-border bg-charcoal-card p-3 font-mono text-[12px] leading-5 text-cream">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="min-w-full border-collapse border border-charcoal-border text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-charcoal-border bg-charcoal-card px-2.5 py-1.5 font-semibold text-cream-bright">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-charcoal-border px-2.5 py-1.5 text-cream-muted">
              {children}
            </td>
          ),
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

function prepareEmailDocument(rawHtml: string): string {
  const injectedHead = `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; script-src 'none'; img-src data: cid: https: http:; media-src data: https: http:; font-src data: https: http:; style-src 'unsafe-inline'">
    <base target="_blank">
    <style>
      html {
        margin: 0;
        padding: 0;
        height: auto !important;
        min-height: 0 !important;
      }
      body {
        margin: 0;
        padding: 16px;
        height: auto !important;
        min-height: 0 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #1f2937;
        background-color: #ffffff;
        word-break: break-word;
        overflow-wrap: break-word;
        overflow-y: hidden;
        box-sizing: border-box;
      }
      *, *:before, *:after {
        box-sizing: inherit;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      table {
        max-width: 100% !important;
      }
      a {
        color: #2563eb;
      }
    </style>
  `;

  if (/<head>/i.test(rawHtml)) {
    return rawHtml.replace(/<head>/i, `<head>${injectedHead}`);
  }
  if (/<html>/i.test(rawHtml)) {
    return rawHtml.replace(/<html>/i, `<html><head>${injectedHead}</head>`);
  }
  return `<!DOCTYPE html><html><head>${injectedHead}</head><body>${rawHtml}</body></html>`;
}

/** Downloaded Inbox mounts own this module's prefetch frame and cached documents. */
export function disposeEmailRenderCache(): void {
  if (measurementIframe) {
    measurementIframe.onload = null;
    measurementIframe.remove();
    measurementIframe = null;
  }
  pendingMeasurements.clear();
  heightCache.clear();
  documentCache.clear();
}
