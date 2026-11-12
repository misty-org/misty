// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { IconButton, Input } from "@/shared/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { filesApi } from "../files/filesApi";
import { useFilesStore } from "../files/filesStore";
import { keepFindInputFocus } from "./EditorSearchPanel";
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

  // Images named relative to the file load through the gate as data URLs; the app's own pages
  // can't load a linked folder's files directly.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let live = true;
    for (const image of Array.from(root.querySelectorAll("img"))) {
      const src = image.getAttribute("src") ?? "";
      if (!src || /^(?:https?:|data:|blob:)/i.test(src) || !IMAGE_RE.test(src)) continue;
      const target = resolveMarkdownLinkPath(src, path);
      if (!target) continue;
      void filesApi
        .readFile(target)
        .then((content) => {
          if (live && content.dataUrl) image.src = content.dataUrl;
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
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
        <div
          role="search"
          aria-label="Find in document"
          className="editor-find"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onSearchOpenChange?.(false);
            } else if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
        >
          <div className="editor-find-row">
            <div className="editor-find-field">
              <Input
                variant="bare"
                ref={inputRef}
                value={query}
                placeholder="Find"
                aria-label="Find"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCursor(0);
                }}
              />
              <IconButton
                label="Match case"
                size="xs"
                className="editor-find-toggle"
                aria-pressed={caseSensitive}
                onMouseDown={keepFindInputFocus}
                onClick={() => (setCaseSensitive(!caseSensitive), setCursor(0))}
              >
                Aa
              </IconButton>
              <IconButton
                label="Whole word"
                size="xs"
                className="editor-find-toggle"
                aria-pressed={wholeWord}
                onMouseDown={keepFindInputFocus}
                onClick={() => (setWholeWord(!wholeWord), setCursor(0))}
              >
                W
              </IconButton>
              <IconButton
                label="Regular expression"
                size="xs"
                className="editor-find-toggle font-mono"
                aria-pressed={useRegex}
                onMouseDown={keepFindInputFocus}
                onClick={() => (setUseRegex(!useRegex), setCursor(0))}
              >
                .*
              </IconButton>
            </div>
            <span
              role="status"
              className="editor-find-status"
              data-empty={(query.trim() && matchCount === 0) || undefined}
            >
              {matchCount > 0 ? `${safeCursor + 1}/${matchCount}` : "No results"}
            </span>
            <IconButton
              label="Previous match (Shift+Enter)"
              size="xs"
              disabled={matchCount === 0}
              onMouseDown={keepFindInputFocus}
              onClick={() => step(-1)}
            >
              <ChevronUp />
            </IconButton>
            <IconButton
              label="Next match (Enter)"
              size="xs"
              disabled={matchCount === 0}
              onMouseDown={keepFindInputFocus}
              onClick={() => step(1)}
            >
              <ChevronDown />
            </IconButton>
            <IconButton label="Close (Esc)" size="xs" onClick={() => onSearchOpenChange?.(false)}>
              <X />
            </IconButton>
          </div>
        </div>
      ) : null}
      <div ref={scrollRef} className="editor-markdown" onClick={onClick}>
        <div ref={contentRef}>
          <MarkdownDocument draft={deferredDraft} />
        </div>
      </div>
    </div>
  );
}
