// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  memo,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { FindBar, Text } from "@misty/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { imageFileUrl } from "../files/filesApi";
import { useFilesStore } from "../files/filesStore";
import {
  clearMarkdownSearchHighlights,
  findMarkdownMatches,
  paintMarkdownSearchHighlights,
  scrollRangeIntoView,
} from "./markdownSearch";

const IMAGE_RE = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

export function normalizePathSegments(path: string): string {
  const isAbsolute = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(path);
  const out: string[] = [];
  for (const segment of path.split(/[\\/]+/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  const joined = out.join("/");
  if (!isAbsolute) return joined;
  return (/^[a-zA-Z]:/.test(path) ? "" : "/") + joined;
}

/**
 * A link's target next to the Markdown file (`./docs/x.md`, `../a.png`) as an absolute path;
 * null for a URL, any scheme, an anchor or a folder, none of which the editor may open.
 */
export function resolveMarkdownLinkPath(href: string, sourceFilePath: string): string | null {
  let cleaned: string;
  try {
    cleaned = decodeURIComponent(href);
  } catch {
    cleaned = href;
  }
  if (!cleaned || cleaned.startsWith("#")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return null;
  const pathOnly = cleaned.replace(/[?#].*$/, "");
  if (!pathOnly) return null;
  // A folder link (`./docs/`) or a name without an extension isn't a file.
  const last = pathOnly.split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (!last.includes(".")) return null;
  if (/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(pathOnly)) return normalizePathSegments(pathOnly);
  const separator = Math.max(sourceFilePath.lastIndexOf("/"), sourceFilePath.lastIndexOf("\\"));
  if (separator <= 0) return null;
  return normalizePathSegments(`${sourceFilePath.slice(0, separator)}/${pathOnly}`);
}

/** The parsed document, behind memo: opening the find bar or typing in it never parses again. */
const MarkdownDocument = memo(function MarkdownDocument({ draft }: { draft: string }) {
  return (
    <div className="misty-markdown">
      <MistyMarkdown>{draft}</MistyMarkdown>
    </div>
  );
});

/**
 * A Markdown file rendered as the chat renders replies, from the draft being edited. Images next
 * to the file show (read through the linked-folder gate); links to files open them as tabs, web
 * links open in the browser. Find (⌘F) highlights matches without touching the document.
 */
export function MarkdownPreview({
  path,
  draft,
  active = true,
  searchOpen = false,
  onSearchOpenChange,
}: {
  path: string;
  draft: string;
  active?: boolean;
  searchOpen?: boolean;
  onSearchOpenChange?(open: boolean): void;
}) {
  // A deferred copy, so parsing the whole document never slows typing.
  const deferredDraft = useDeferredValue(draft);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  // Highlights live in one registry for the page: only clear them when this preview painted.
  const paintedRef = useRef(false);

  // Images named relative to the file load over `misty-file:`, which checks them natively against
  // the linked folders; the app's own pages can't load a linked folder's files directly.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    for (const image of Array.from(root.querySelectorAll("img"))) {
      const src = image.getAttribute("src") ?? "";
      const loadable = src && !/^(?:https?:|data:|blob:|misty-file:)/i.test(src);
      if (!loadable || !IMAGE_RE.test(src)) continue;
      const target = resolveMarkdownLinkPath(src, path);
      if (!target) continue;
      image.decoding = "async";
      image.src = imageFileUrl(target);
    }
  }, [deferredDraft, path]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  // Matches again on query, content or cursor changes; the observer catches content rendered
  // late. Frames merge bursts of changes.
  useEffect(() => {
    const root = contentRef.current;
    if (!searchOpen || !active || !root || !query.trim()) {
      setMatchCount(0);
      if (paintedRef.current) {
        paintedRef.current = false;
        clearMarkdownSearchHighlights();
      }
      return;
    }
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const ranges = findMarkdownMatches(root, query, {
          caseSensitive,
          wholeWord,
          regexp: useRegex,
        });
        setMatchCount(ranges.length);
        const index = ranges.length > 0 ? Math.min(cursor, ranges.length - 1) : 0;
        paintMarkdownSearchHighlights(ranges, index);
        paintedRef.current = true;
        scrollRangeIntoView(scrollRef.current, ranges[index]);
      });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [searchOpen, active, query, cursor, caseSensitive, wholeWord, useRegex, deferredDraft]);

  useEffect(
    () => () => {
      if (!paintedRef.current) return;
      paintedRef.current = false;
      clearMarkdownSearchHighlights();
    },
    [],
  );

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    // The app's own window must never follow a link from a document.
    event.preventDefault();
    if (/^https?:/i.test(href) || /^mailto:/i.test(href)) {
      openExternalLink(href);
      return;
    }
    const local = resolveMarkdownLinkPath(href, path);
    if (local) void useFilesStore.getState().openFile(local);
  };

  const safeCursor = matchCount > 0 ? Math.min(cursor, matchCount - 1) : 0;
  const step = (delta: number) => {
    if (matchCount > 0) setCursor((safeCursor + delta + matchCount) % matchCount);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {searchOpen ? (
        <FindBar
          label="Find in document"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onSearchOpenChange?.(false);
            } else if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
          find={{
            value: query,
            inputRef,
            onChange: (value) => {
              setQuery(value);
              setCursor(0);
            },
          }}
          caseSensitive={caseSensitive}
          onCaseSensitive={() => {
            setCaseSensitive(!caseSensitive);
            setCursor(0);
          }}
          wholeWord={wholeWord}
          onWholeWord={() => {
            setWholeWord(!wholeWord);
            setCursor(0);
          }}
          regex={useRegex}
          onRegex={() => {
            setUseRegex(!useRegex);
            setCursor(0);
          }}
          count={matchCount > 0 ? `${safeCursor + 1}/${matchCount}` : "No results"}
          empty={Boolean(query.trim()) && matchCount === 0}
          canStep={matchCount > 0}
          onPrevious={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => onSearchOpenChange?.(false)}
        />
      ) : null}
      <Text
        bare
        as="div"
        size="control"
        tone="default"
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto p-4"
        onClick={onClick}
      >
        <div ref={contentRef}>
          <MarkdownDocument draft={deferredDraft} />
        </div>
      </Text>
    </div>
  );
}
