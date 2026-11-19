import { CaseSensitive, ChevronDown, ChevronRight, ChevronsDownUp, WholeWord } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import {
  Badge,
  IconButton,
  Input,
  Pressable,
  SkeletonList,
  Surface,
  Text,
  ToolbarDivider,
} from "@/shared/ui";
import { useEditorReveal } from "../context-panel/editor/editorReveal";
import { errorText } from "../context-panel/projectApi";
import { filesApi, type SearchHit } from "../context-panel/files/filesApi";
import { getFileTreeIconSvg } from "../context-panel/files/fileIcons";
import { fileName, useFilesStore } from "../context-panel/files/filesStore";

/** The search as the person left it, kept while the sidebar shows another view. */
export const useProjectSearch = create<{
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  collapsed: Record<string, true>;
  /** Bumped by ⌘⇧F, so the field takes focus each time. */
  focusNonce: number;
  set(patch: Partial<{ query: string; caseSensitive: boolean; wholeWord: boolean }>): void;
  toggle(path: string): void;
  collapseAll(paths: string[]): void;
  focus(): void;
}>((set) => ({
  query: "",
  caseSensitive: false,
  wholeWord: false,
  collapsed: {},
  focusNonce: 0,
  set: (patch) => set(patch),
  toggle: (path) =>
    set((state) => {
      const collapsed = { ...state.collapsed };
      if (collapsed[path]) delete collapsed[path];
      else collapsed[path] = true;
      return { collapsed };
    }),
  collapseAll: (paths) => set({ collapsed: Object.fromEntries(paths.map((path) => [path, true])) }),
  focus: () => set((state) => ({ focusNonce: state.focusNonce + 1 })),
}));

const DEBOUNCE_MS = 250;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The match as a pattern: the folder's search ignores case, and these narrow what it found. */
function matcher(query: string, caseSensitive: boolean, wholeWord: boolean): RegExp {
  const body = escapeRegex(query);
  return new RegExp(wholeWord ? `\\b${body}\\b` : body, caseSensitive ? "g" : "gi");
}

/** One line's text cut into the match and what surrounds it, starting a little before the first
 * match so it shows even in a long line. */
function lineParts(text: string, pattern: RegExp): { text: string; hit: boolean }[] {
  const trimmed = text.trimStart();
  pattern.lastIndex = 0;
  const first = pattern.exec(trimmed);
  const start = first && first.index > 24 ? first.index - 16 : 0;
  const shown = trimmed.slice(start);
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(shown); match; match = pattern.exec(shown)) {
    if (!match[0]) break;
    if (match.index > last) parts.push({ text: shown.slice(last, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < shown.length) parts.push({ text: shown.slice(last), hit: false });
  return parts;
}

/**
 * The Code page's search across the folder, after VS Code's: the field with match case and
 * whole word, how many results in how many files, then each file with its matching lines under
 * it, the match brightened. A line opens its file at that line.
 */
export function ProjectSearch({ root }: { root: string }) {
  const { query, caseSensitive, wholeWord, collapsed, focusNonce } = useProjectSearch();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  // The folder's search runs once typing pauses; the toggles only narrow what it found.
  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setHits(null);
      setPending(false);
      return;
    }
    let live = true;
    setPending(true);
    setError("");
    const timer = window.setTimeout(() => {
      void filesApi
        .searchText(root, needle)
        .then((found) => {
          if (!live) return;
          setHits(found);
          setPending(false);
        })
        .catch((reason) => {
          if (!live) return;
          setHits([]);
          setPending(false);
          setError(errorText(reason));
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, root]);

  const needle = query.trim();
  const pattern = useMemo(
    () => (needle ? matcher(needle, caseSensitive, wholeWord) : null),
    [needle, caseSensitive, wholeWord],
  );
  const groups = useMemo(() => {
    if (!hits || !pattern) return [];
    const byFile = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      pattern.lastIndex = 0;
      if (!pattern.test(hit.text)) continue;
      byFile.set(hit.path, [...(byFile.get(hit.path) ?? []), hit]);
    }
    return [...byFile.entries()];
  }, [hits, pattern]);
  const total = groups.reduce((sum, [, lines]) => sum + lines.length, 0);

  const openLine = (hit: SearchHit) => {
    useEditorReveal.getState().reveal(hit.path, hit.line);
    void useFilesStore.getState().openFile(hit.path);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="search" aria-label="Search in files">
      <div className="flex h-10 flex-none border-b items-center gap-1 px-2">
        <Input
          ref={inputRef}
          className="min-w-0 flex-1"
          aria-label="Search in files"
          placeholder="Search"
          value={query}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => useProjectSearch.getState().set({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") useProjectSearch.getState().set({ query: "" });
          }}
        />
        <IconButton
          label="Match case"
          aria-pressed={caseSensitive}
          onClick={() => useProjectSearch.getState().set({ caseSensitive: !caseSensitive })}
        >
          <CaseSensitive />
        </IconButton>
        <IconButton
          label="Whole word"
          aria-pressed={wholeWord}
          onClick={() => useProjectSearch.getState().set({ wholeWord: !wholeWord })}
        >
          <WholeWord />
        </IconButton>
        {groups.length ? (
          <>
            <ToolbarDivider />
            <IconButton
              label="Collapse all"
              onClick={() => useProjectSearch.getState().collapseAll(groups.map(([path]) => path))}
            >
              <ChevronsDownUp />
            </IconButton>
          </>
        ) : null}
      </div>
      {needle && !pending && hits ? (
        <Text size="caption" tone="muted" className="flex-none px-3 pb-1">
          {total === 0
            ? "No results"
            : `${total}${hits.length >= 200 ? "+" : ""} ${total === 1 ? "result" : "results"} in ${groups.length} ${groups.length === 1 ? "file" : "files"}`}
        </Text>
      ) : null}
      {error ? (
        <Text wrap size="caption" tone="removed" className="px-3 pb-1" role="alert">
          {error}
        </Text>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {pending && !hits ? (
          <SkeletonList
            label="Searching"
            rows={8}
            leading="icon"
            lines={1}
            rowClassName="h-8 min-h-0 gap-2 px-2"
            className="gap-0"
          />
        ) : (
          groups.map(([path, lines]) => {
            const name = fileName(path);
            const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
            const dir = relative.slice(0, relative.length - name.length).replace(/\/$/, "");
            const open = !collapsed[path];
            return (
              <section key={path} aria-label={relative}>
                <Surface
                  tone="none"
                  radius="md"
                  wash="row"
                  className="flex h-8 min-w-0 items-center gap-1 pr-2 pl-1 text-meta"
                >
                  <Pressable
                    className="flex h-full min-w-0 flex-1 items-center gap-2"
                    aria-expanded={open}
                    onClick={() => useProjectSearch.getState().toggle(path)}
                  >
                    <Text bare tone="muted" className="flex flex-none">
                      {open ? <ChevronDown /> : <ChevronRight />}
                    </Text>
                    <span
                      className="inline-flex size-4 flex-none items-center justify-center"
                      aria-hidden
                      dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, false) }}
                    />
                    <Text tone="default" className="min-w-0 flex-[0_1_auto]">
                      {name}
                    </Text>
                    {dir ? (
                      <Text size="caption" tone="muted" className="min-w-0 flex-1">
                        {dir}
                      </Text>
                    ) : null}
                  </Pressable>
                  <Badge variant="count">{lines.length}</Badge>
                </Surface>
                {open
                  ? lines.map((hit) => (
                      <Surface
                        key={`${hit.path}:${hit.line}`}
                        as={Pressable}
                        tone="none"
                        radius="md"
                        wash="row"
                        className="flex h-8 w-full min-w-0 items-center pr-2 pl-12 text-left text-meta"
                        onClick={() => openLine(hit)}
                      >
                        <Text tone="muted" className="min-w-0 flex-1">
                          {pattern
                            ? lineParts(hit.text, pattern).map((part, index) =>
                                part.hit ? (
                                  <Text bare key={index} tone="bright" weight="medium">
                                    {part.text}
                                  </Text>
                                ) : (
                                  <span key={index}>{part.text}</span>
                                ),
                              )
                            : hit.text}
                        </Text>
                      </Surface>
                    ))
                  : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
