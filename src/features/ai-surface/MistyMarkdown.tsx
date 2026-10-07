import "katex/dist/katex.min.css";
import "./mistyMarkdown.css";
import { Button, IconButton } from "@/shared/ui";
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
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

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
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight, rehypeCallouts] as unknown as ComponentProps<
  typeof ReactMarkdown
>["rehypePlugins"];

const components: Components = {
  pre: ({ node, children }) => {
    const code = (node as unknown as HastNode | undefined)?.children?.find(
      (child) => child.tagName === "code",
    );
    const classes = code?.properties?.className;
    const language = (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
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
};

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
 * Markdown for Misty's replies: GitHub-flavored Markdown (tables, task lists,
 * strikethrough, autolinks, footnotes), math, monochrome code highlighting with a
 * language label and Copy, and GitHub-style callouts. Raw HTML is never rendered.
 */
export function MistyMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}

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
