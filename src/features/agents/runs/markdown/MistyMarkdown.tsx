import "katex/dist/katex.min.css";
import {
  Button,
  CopyButton,
  lazyTool,
  Prose,
  ProseCallout,
  ProseCode,
  ProseTable,
  ToolSuspense,
} from "@misty/ui";
import {
  CircleAlert,
  Image as ImageIcon,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
} from "lucide-react";
import {
  isValidElement,
  createContext,
  Fragment,
  memo,
  startTransition,
  useContext,
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
import { isLinkableFilePath, toFileLink } from "./fileLinks/file_links";
import { readableJson } from "./readable_json";
import { healMarkdown } from "./streaming/heal_markdown";
import { closedFence, useCodeTokens } from "./streaming/shiki_tokens";
import { splitMarkdown } from "./streaming/markdown_chunks";
import { createRevealPlan } from "./streaming/reveal_plan";
import { RevealText } from "./streaming/RevealText";
import type { StreamReveal } from "./streaming/stream_reveal";
import { useLiveReveal } from "./streaming/use_live_reveal";

const SketchBlock = lazyTool(() =>
  import("@/features/agents/tutor/cursor/SketchBlock").then(({ SketchBlock }) => ({
    default: SketchBlock,
  })),
);

type HastPosition = { start: { offset?: number }; end: { offset?: number } };

const MarkdownSource = createContext({ source: "", live: false });

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

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

const remarkPlugins: ComponentProps<typeof ReactMarkdown>["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];
type PluginList = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

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
    if (language === "misty-sketch")
      return (
        <ToolSuspense
          tool="sketch"
          label="Drawing the sketch"
          frame={(state) => <div className="my-3 h-70">{state}</div>}
        >
          <SketchBlock source={hastText(code)} />
        </ToolSuspense>
      );
    const position = (node as unknown as { position?: HastPosition } | undefined)?.position;
    return (
      <CodeBlock
        language={language}
        code={hastText(code).replace(/\n$/, "")}
        start={position?.start.offset}
        end={position?.end.offset}
      >
        {children}
      </CodeBlock>
    );
  },
  table: ({ children }) => <ProseTable>{children}</ProseTable>,
  blockquote: ({ node, children }) => {
    const kind = (node as unknown as HastNode | undefined)?.properties?.dataCallout as
      CalloutKind | undefined;
    if (!kind) return <blockquote>{children}</blockquote>;
    const { label, Icon } = callouts[kind];
    return (
      <ProseCallout kind={kind} label={label} icon={Icon}>
        {children}
      </ProseCallout>
    );
  },
  img: ({ src, alt }) =>
    typeof src === "string" && src ? <ReplyImage src={src} alt={alt ?? ""} /> : null,
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

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function ReplyImage({ src, alt }: { src: string; alt: string }) {
  const [shown, setShown] = useState(false);
  const host = remoteImageHost(src);
  if (!host || shown) return <img src={src} alt={alt} loading="lazy" />;
  return (
    <Button type="button" size="sm" icon={ImageIcon} onClick={() => setShown(true)}>
      {alt ? `Show image "${alt}" from ${host}` : `Show image from ${host}`}
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

const PROGRESSIVE_MARKDOWN_FROM = 16_000;

function afterPaint(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

const MarkdownChunk = memo(function MarkdownChunk({
  text,
  rehypePlugins,
  components,
  live,
}: {
  text: string;
  rehypePlugins: PluginList;
  components: Components;
  live: boolean;
}) {
  const source = useMemo(() => ({ source: text, live }), [text, live]);
  return (
    <MarkdownSource.Provider value={source}>
      <div className="contents">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </div>
    </MarkdownSource.Provider>
  );
});

function streamingComponents(controller: StreamReveal): Components {
  return {
    ...baseComponents,
    span: ({ node, className, children, ...rest }) => {
      const start = node?.properties.dataStreamStart;
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

type MarkdownSize = ComponentProps<typeof Prose>["size"];

export const MistyMarkdown = memo(function MistyMarkdown({
  children,
  streaming = false,
  size,
  className,
}: {
  children: string;
  streaming?: boolean;
  size?: MarkdownSize;
  className?: string;
}) {
  return (
    <Prose size={size} className={className}>
      <MarkdownBody streaming={streaming}>{children}</MarkdownBody>
    </Prose>
  );
});

const MarkdownBody = memo(function MarkdownBody({
  children,
  streaming,
}: {
  children: string;
  streaming: boolean;
}) {
  const text = useMemo(
    () => (streaming ? healMarkdown(children) : readableJson(children)),
    [children, streaming],
  );
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
  const reveal = revealEnabled && !large;
  const blocks = useMemo(
    () => (reveal ? splitMarkdown(text, LIVE_BLOCK_TARGET) : []),
    [reveal, text],
  );
  const parts = useRef({
    starts: [] as number[],
    visible: new Map<number, string>(),
    plugins: new Map<string, PluginList>(),
  });
  const liveText = useMemo(() => {
    const current = parts.current;
    current.starts = blocks.map((block) => block.start);
    const keys = new Set(blocks.map(blockKey));
    for (const start of [...current.visible.keys()])
      if (!current.starts.includes(start)) current.visible.delete(start);
    for (const key of [...current.plugins.keys()]) if (!keys.has(key)) current.plugins.delete(key);
    return {
      get text() {
        return current.starts.map((start) => current.visible.get(start) ?? "").join("");
      },
    };
  }, [blocks]);
  const controller = useLiveReveal(liveText, streaming && reveal);
  const components = useMemo(() => streamingComponents(controller), [controller]);
  const settledPlugins = useMemo(() => [rehypeKatex, rehypeCallouts] as PluginList, []);
  const blockPlugins = (block: { start: number; text: string }) => {
    const current = parts.current;
    const key = blockKey(block);
    const known = current.plugins.get(key);
    if (known) return known;
    const plan = createRevealPlan({
      base: () =>
        current.starts
          .filter((start) => start < block.start)
          .reduce((sum, start) => sum + (current.visible.get(start)?.length ?? 0), 0),
      onText: (visible) => current.visible.set(block.start, visible),
    });
    const plugins = [rehypeKatex, rehypeCallouts, plan.plugin] as PluginList;
    current.plugins.set(key, plugins);
    return plugins;
  };
  if (!showMarkdown) return <div className="whitespace-pre-wrap">{text}</div>;
  if (reveal)
    return (
      <>
        {blocks.map((block, index) => (
          <MarkdownChunk
            key={block.start}
            text={block.text}
            rehypePlugins={blockPlugins(block)}
            components={components}
            live={streaming && index === blocks.length - 1}
          />
        ))}
      </>
    );
  if (large)
    return (
      <>
        {chunks.map((chunk, index) =>
          index < mountedChunks ? (
            <MarkdownChunk
              key={chunk.start}
              text={chunk.text}
              rehypePlugins={settledPlugins}
              components={components}
              live={streaming && index === chunks.length - 1}
            />
          ) : (
            <div className="contents" key={chunk.start} aria-busy="true">
              <div className="whitespace-pre-wrap">{chunk.text}</div>
            </div>
          ),
        )}
      </>
    );
  return (
    <MarkdownChunk
      text={text}
      rehypePlugins={settledPlugins}
      components={components}
      live={streaming}
    />
  );
});

const LIVE_BLOCK_TARGET = 1_500;

const blockKey = (block: { start: number; text: string }) => `${block.start}\u0000${block.text}`;

function CodeBlock({
  language,
  code,
  start,
  end,
  children,
}: {
  language?: string;
  code: string;
  start?: number;
  end?: number;
  children: ReactNode;
}) {
  const pre = useRef<HTMLPreElement>(null);
  const { source, live } = useContext(MarkdownSource);
  const settled = !live || (start != null && end != null && closedFence(source.slice(start, end)));
  const lines = useCodeTokens(code, language, settled);
  return (
    <ProseCode
      ref={pre}
      language={language}
      actions={
        <CopyButton label="Copy code" size="sm" value={() => pre.current?.textContent ?? ""} />
      }
    >
      {lines ? (
        <code>
          {lines.map((line, row) => (
            <Fragment key={row}>
              {row ? "\n" : null}
              {line.map((token, index) => (
                <span key={index} style={{ color: token.color }}>
                  {token.content}
                </span>
              ))}
            </Fragment>
          ))}
        </code>
      ) : (
        children
      )}
    </ProseCode>
  );
}
