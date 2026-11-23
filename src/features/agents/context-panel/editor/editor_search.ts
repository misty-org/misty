// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { EditorSelection, Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding, type Panel } from "@codemirror/view";
import { SearchQuery, search as cmSearch, setSearchQuery } from "@codemirror/search";

export const EDITOR_SEARCH_MATCH_LIMIT = 10_000;

export interface EditorSearchQueryOptions {
  search: string;
  replace?: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

export function createEditorSearchQuery(options: EditorSearchQueryOptions): SearchQuery {
  return new SearchQuery({
    search: options.search,
    replace: options.replace ?? "",
    caseSensitive: options.caseSensitive,
    regexp: options.regexp,
    wholeWord: options.wholeWord,
    literal: !options.regexp,
  });
}

export function dispatchEditorSearchQuery(
  view: EditorView,
  options: EditorSearchQueryOptions,
): SearchQuery {
  const query = createEditorSearchQuery(options);
  view.dispatch({ effects: setSearchQuery.of(query) });
  return query;
}

export function clearEditorSearchQuery(view: EditorView) {
  view.dispatch({
    effects: setSearchQuery.of(
      createEditorSearchQuery({
        search: "",
        caseSensitive: false,
        regexp: false,
        wholeWord: false,
      }),
    ),
  });
}

interface EditorSearchMatch {
  from: number;
  to: number;
}

export interface EditorSearchMatchInfo {
  total: number;
  index: number;
  truncated: boolean;
  valid: boolean;
}

export const EMPTY_EDITOR_SEARCH_MATCH_INFO: EditorSearchMatchInfo = {
  total: 0,
  index: 0,
  truncated: false,
  valid: false,
};

export function editorSearchMatchInfo(
  state: EditorState,
  query: SearchQuery,
  limit = EDITOR_SEARCH_MATCH_LIMIT,
): EditorSearchMatchInfo {
  if (!query.valid) return EMPTY_EDITOR_SEARCH_MATCH_INFO;
  const cappedLimit = Math.max(1, limit);
  const selection = state.selection.main;
  let total = 0;
  let index = 0;
  let truncated = false;
  const cursor = query.getCursor(state);
  let next = cursor.next();
  while (!next.done) {
    total += 1;
    if (next.value.from === selection.from && next.value.to === selection.to) {
      index = total;
    }
    if (total >= cappedLimit) {
      truncated = !cursor.next().done;
      break;
    }
    next = cursor.next();
  }
  return {
    total,
    index: index || (total > 0 ? 1 : 0),
    truncated,
    valid: true,
  };
}

function scrollMatchToCenter(range: { from: number; to: number }) {
  return EditorView.scrollIntoView(EditorSelection.range(range.from, range.to), { y: "center" });
}

export function selectEditorSearchMatchFromCursor(view: EditorView, query: SearchQuery): boolean {
  if (!query.valid) return false;
  const { from } = view.state.selection.main;
  const cursor = query.getCursor(view.state, view.state.doc.lineAt(from).from);
  let hit = cursor.next();
  while (!hit.done && hit.value.from < from) hit = cursor.next();
  if (hit.done) hit = query.getCursor(view.state).next();
  if (hit.done) return false;
  view.dispatch({
    selection: EditorSelection.single(hit.value.from, hit.value.to),
    effects: scrollMatchToCenter(hit.value),
    userEvent: "select.search",
  });
  return true;
}

export function collectEditorSearchMatches(
  state: EditorState,
  query: SearchQuery,
  limit = EDITOR_SEARCH_MATCH_LIMIT,
): EditorSearchMatch[] {
  if (!query.valid) return [];
  const matches: EditorSearchMatch[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    matches.push({ from: next.value.from, to: next.value.to });
    if (matches.length >= limit) break;
  }
  return matches;
}

export interface EditorSearchKeymapActions {
  openFind(view: EditorView): boolean;
  openReplace(view: EditorView): boolean;
  findNext(view: EditorView): boolean;
  findPrevious(view: EditorView): boolean;
  close(): boolean;
}

export function editorSearchReplaceKey(isMac: boolean): string {
  return isMac ? "Alt-Mod-f" : "Mod-h";
}

export function editorSearchKeyBindings(
  actions: EditorSearchKeymapActions,
  isMac: boolean,
): KeyBinding[] {
  return [
    { key: "Mod-f", preventDefault: true, run: (view) => actions.openFind(view) },
    {
      key: editorSearchReplaceKey(isMac),
      preventDefault: true,
      run: (view) => actions.openReplace(view),
    },
    {
      key: "F3",
      preventDefault: true,
      run: (view) => actions.findNext(view),
      shift: (view) => actions.findPrevious(view),
    },
    {
      key: "Mod-g",
      preventDefault: true,
      run: (view) => actions.findNext(view),
      shift: (view) => actions.findPrevious(view),
    },
    { key: "Escape", run: () => actions.close() },
  ];
}

interface EditorSearchActionSource {
  current: EditorSearchKeymapActions;
}

export function createHiddenEditorSearchPanel(): Panel {
  const dom = document.createElement("span");
  dom.hidden = true;
  return {
    dom,
    top: true,
    mount() {
      if (dom.parentElement instanceof HTMLElement) {
        dom.parentElement.style.display = "none";
      }
    },
  };
}

export function createEditorSearchExtensions(
  actions: EditorSearchActionSource,
  isMac: boolean,
): Extension[] {
  return [
    cmSearch({
      top: true,
      createPanel: createHiddenEditorSearchPanel,
      scrollToMatch: scrollMatchToCenter,
    }),
    Prec.high(
      keymap.of(
        editorSearchKeyBindings(
          {
            openFind: (view) => actions.current.openFind(view),
            openReplace: (view) => actions.current.openReplace(view),
            findNext: (view) => actions.current.findNext(view),
            findPrevious: (view) => actions.current.findPrevious(view),
            close: () => actions.current.close(),
          },
          isMac,
        ),
      ),
    ),
  ];
}

export function requestIdle(callback: () => void): number {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback, { timeout: 500 });
  }
  return window.setTimeout(callback, 0);
}

export function cancelIdle(handle: number) {
  if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle);
  } else {
    window.clearTimeout(handle);
  }
}

export const SEARCH_DEBOUNCE_MS = 120;
export const DOCUMENT_SEARCH_DEBOUNCE_MS = 400;
export const SEED_SELECTION_MAX_CHARS = 200;

export type EditorSearchDirection = "next" | "prev";

export interface EditorSearchFocusRequest {
  target: "find" | "replace";
  token: number;
}
