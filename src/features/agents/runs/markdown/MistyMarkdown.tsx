import "katex/dist/katex.min.css";
import "./mistyMarkdown.css";
import { Button, IconButton, Skeleton } from "@/shared/ui";
import {
  Check,
  CircleAlert,
  Copy,
  Image as ImageIcon,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
} from "lucide-react";
import {
  isValidElement,
  lazy,
  memo,
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { FileLink } from "./fileLinks/FileLink";
import { isLinkableFilePath, toFileLink } from "./fileLinks/fileLinks";
import { readableJson } from "./readableJson";
import { createCachedHighlighter } from "./streaming/cachedHighlight";
import { splitMarkdown } from "./streaming/markdownChunks";
import { createRevealPlan } from "./streaming/revealPlan";
import { RevealText } from "./streaming/RevealText";
import type { StreamReveal } from "./streaming/streamReveal";
import { useLiveReveal } from "./streaming/useLiveReveal";

// Drawings are rare and their renderer is large: it loads when the first one appears.
const SketchBlock = lazy(() =>
  import("@/features/agents/tutor/cursor/SketchBlock").then(({ SketchBlock }) => ({
    default: SketchBlock,
  })),
);

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** The plain text inside a node, through any highlighting spans. */
function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

const callouts = {
  note: { label: "Note", Icon: Info },
  tip: { label: "Tip", Icon: Lightbulb },
  important: { label: "Important", Icon: MessageSquareWarning },
  warning: { label: "Warning", Icon: CircleAlert },
  caution: { label: "Caution", Icon: OctagonAlert },
} as const;
type CalloutKind = keyof typeof callouts;

/**
 * GitHub-style alerts: a blockquote that opens with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]` or `[!CAUTION]` becomes a callout. The marker is removed from the text.
 */
function rehypeCallouts() {
  const walk = (node: HastNode) => {
    if (node.type === "element" && node.tagName === "blockquote") {
      const paragraph = node.children?.find((child) => child.type === "element");
      const text = paragraph?.tagName === "p" ? paragraph.children?.[0] : undefined;
      const match = text?.type === "text" ? /^\[!(\w+)\][ \t]*\n?/.exec(text.value ?? "") : null;
      const kind = match?.[1].toLowerCase();
      if (text && match && kind && kind in callouts) {
        text.value = (text.value ?? "").slice(match[0].length);
        node.properties = { ...node.properties, dataCallout: kind };
      }
    }
    node.children?.forEach(walk);
  };
  return (tree: HastNode) => walk(tree);
}

// Module constants, so memoized messages never see new plugin arrays.
// Single dollars are prices in replies ("$24 or $12"), never math; math takes $$ blocks.
const remarkPlugins: ComponentProps<typeof ReactMarkdown>["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];
type PluginList = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

/** The components every reply shares; the streaming ones are added per message. */
const baseComponents: Components = {
  pre: ({ node, children }) => {
    const code = (node as unknown as HastNode | undefined)?.children?.find(
      (child) => child.tagName === "code",
    );
    const classes = code?.properties?.className;
    const language = (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    // A companion drawing (companionSketch.ts) shows as the drawing, not its source.
    if (language === "misty-sketch")
      return (
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <SketchBlock source={hastText(code)} />
        </Suspense>
      );
    return <CodeBlock language={language}>{children}</CodeBlock>;
  },
  table: ({ children }) => (
    // Wide tables scroll inside the message instead of stretching it.
    <div className="misty-markdown-table">
      <table>{children}</table>
    </div>
  ),
  blockquote: ({ node, children }) => {
    const kind = (node as unknown as HastNode | undefined)?.properties?.dataCallout as
      CalloutKind | undefined;
    if (!kind) return <blockquote>{children}</blockquote>;
    const { label, Icon } = callouts[kind];
    return (
      <aside className="misty-markdown-callout" data-callout={kind} aria-label={label}>
        <p className="misty-markdown-callout-title">
          <Icon size={14} aria-hidden="true" />
          {label}
        </p>
        {children}
      </aside>
    );
  },
  img: ({ src, alt }) =>
    typeof src === "string" && src ? <ReplyImage src={src} alt={alt ?? ""} /> : null,
  // A link whose target is a local file path opens it in the editor (fileLinks/).
  a: ({ node: _node, href, children, ...rest }) =>
    href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && isLinkableFilePath(href) ? (
      <FileLink href={href} path={href}>
        {children}
      </FileLink>
    ) : (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  // So does inline code that is a file path. Block code keeps its newline and is left alone.
  code: ({ node: _node, className, children, ...rest }) => {
    const raw = nodeText(children);
    const value = raw.trim();
    if (className || raw.includes("\n") || !value || !isLinkableFilePath(value))
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    return (
      <FileLink href={toFileLink(value)} path={value}>
        <code>{children}</code>
      </FileLink>
    );
  },
};

/** The raw text of rendered children (highlighting and reveal spans wrap it in elements). */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

/**
 * Replies can repeat text from web pages and files, so a prompt-injected reply
 * could name an image URL that carries private conversation text to another
 * server the moment it renders. Remote images load only when the person asks.
 */
function ReplyImage({ src, alt }: { src: string; alt: string }) {
  const [shown, setShown] = useState(false);
  const host = remoteImageHost(src);
  if (!host || shown) return <img src={src} alt={alt} loading="lazy" />;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="misty-markdown-remote-image"
      onClick={() => setShown(true)}
    >
      <ImageIcon aria-hidden="true" />
      <span>{alt ? `Show image "${alt}" from ${host}` : `Show image from ${host}`}</span>
    </Button>
  );
}

function remoteImageHost(src: string): string | null {
  try {
    const url = new URL(src, window.location.href);
    if (url.origin === window.location.origin) return null;
    return url.host || url.protocol;
  } catch {
    return null;
  }
}

/**
 * Above this size one Markdown tree is split into independent chunks of about 8,000 characters
 * (streaming/markdownChunks.ts): while a reply streams only its growing last chunk is parsed
 * again, and a long settled reply mounts its chunks a couple per frame.
 */
const PROGRESSIVE_MARKDOWN_FROM = 16_000;

/** Lets the plain text paint before the transition starts parsing. */
function afterPaint(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

/** One independently parsed slice of a large reply, memoized so later slices never re-parse it. */
const MarkdownChunk = memo(function MarkdownChunk({
  text,
  rehypePlugins,
  components,
}: {
  text: string;
  rehypePlugins: PluginList;
  components: Components;
}) {
  return (
    <div className="misty-markdown-chunk">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function streamingComponents(controller: StreamReveal): Components {
  return {
    ...baseComponents,
    span: ({ node, className, children, ...rest }) => {
      const start = node?.properties.dataStreamStart;
      // Every other prop goes through: KaTeX places superscripts and fractions with inline styles
      // on bare spans, and dropping them collapses a formula onto the baseline.
      return typeof start === "number" && typeof children === "string" ? (
        <RevealText controller={controller} start={start}>
          {children}
        </RevealText>
      ) : (
        <span className={className} {...rest}>
          {children}
        </span>
      );
    },
  };
}

/**
 * Markdown for Misty's replies: GitHub-flavored Markdown (tables, task lists,
 * strikethrough, autolinks, footnotes), math, monochrome code highlighting with a
 * language label and Copy, and GitHub-style callouts. Raw HTML is never rendered.
 *
 * While `streaming`, received text is revealed at a steady pace across frames
 * (streaming/streamReveal.ts) without re-rendering the tree each frame, highlighted code is
 * cached between parses, and long replies are parsed in chunks.
 */
export const MistyMarkdown = memo(function MistyMarkdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  // JSON is indented once the reply settles; while it streams it can't parse yet.
  const text = useMemo(
    () => (streaming ? children : readableJson(children)),
    [children, streaming],
  );
  const cachedHighlight = useMemo(() => createCachedHighlighter(), []);
  // Settled replies need no reveal spans. Once a live reply used them, keep its DOM shape when it
  // settles so a selection doesn't jump.
  const [revealEnabled, setRevealEnabled] = useState(streaming);
  if (streaming && !revealEnabled) setRevealEnabled(true);
  const large = text.length > PROGRESSIVE_MARKDOWN_FROM;
  const chunks = useMemo(() => (large ? splitMarkdown(text) : []), [large, text]);
  const [markdownReadyFor, setMarkdownReadyFor] = useState<string | null>(null);
  const [visibleChunks, setVisibleChunks] = useState(0);
  useEffect(() => {
    if (!large || streaming || revealEnabled) return;
    let cancelled = false;
    const cancel = afterPaint(() => {
      if (cancelled) return;
      startTransition(() => {
        setVisibleChunks(1);
        setMarkdownReadyFor(text);
      });
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [large, streaming, revealEnabled, text]);
  const showMarkdown = !large || streaming || revealEnabled || markdownReadyFor === text;
  const mountedChunks = streaming || revealEnabled ? chunks.length : visibleChunks;
  useEffect(() => {
    if (
      streaming ||
      revealEnabled ||
      !showMarkdown ||
      !large ||
      visibleChunks === 0 ||
      visibleChunks >= chunks.length
    )
      return;
    let cancelled = false;
    let frame = 0;
    const step = () => {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        setVisibleChunks((count) => Math.min(count + 2, chunks.length));
        step();
      });
    };
    step();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [streaming, revealEnabled, showMarkdown, large, visibleChunks, chunks.length]);
  // Reveal spans count characters through one whole document; a chunked one shows its text whole.
  const reveal = revealEnabled && !large;
  const plan = useMemo(createRevealPlan, [text]);
  // Text already received shows at once on mount; only later arrivals are paced.
  const controller = useLiveReveal(plan, streaming && reveal);
  // A new components object makes ReactMarkdown parse the whole document again.
  const components = useMemo(() => streamingComponents(controller), [controller]);
  const settledPlugins = useMemo(
    () => [rehypeKatex, [cachedHighlight, { streaming: false }], rehypeCallouts] as PluginList,
    [cachedHighlight],
  );
  const rehypePlugins = useMemo(
    () =>
      [
        // Math first: a display formula arrives as a `language-math` code block, which the
        // highlighter would otherwise treat as source code.
        rehypeKatex,
        [cachedHighlight, { streaming }],
        rehypeCallouts,
        ...(reveal ? [plan.plugin] : []),
      ] as PluginList,
    [cachedHighlight, streaming, reveal, plan],
  );
  if (!showMarkdown) return <div className="misty-markdown-plain">{text}</div>;
  if (large)
    return (
      <>
        {chunks.map((chunk, index) =>
          index < mountedChunks ? (
            <MarkdownChunk
              key={chunk.start}
              text={chunk.text}
              rehypePlugins={
                streaming && index === chunks.length - 1 ? rehypePlugins : settledPlugins
              }
              components={components}
            />
          ) : (
            <div className="misty-markdown-chunk" key={chunk.start} aria-busy="true">
              <div className="misty-markdown-plain">{chunk.text}</div>
            </div>
          ),
        )}
      </>
    );
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

function CodeBlock({ language, children }: { language?: string; children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="misty-markdown-code">
      <div className="misty-markdown-code-header">
        <span>{language ?? "Code"}</span>
        <IconButton
          size="xs"
          label={copied ? "Copied" : "Copy code"}
          onClick={() =>
            void navigator.clipboard
              .writeText(pre.current?.textContent ?? "")
              .then(() => setCopied(true))
          }
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      </div>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}
