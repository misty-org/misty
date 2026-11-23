// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from "react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findNext, findPrevious, replaceAll, replaceNext } from "@codemirror/search";
import { FindBar } from "@misty/ui";
import {
  EDITOR_SEARCH_MATCH_LIMIT,
  EMPTY_EDITOR_SEARCH_MATCH_INFO,
  collectEditorSearchMatches,
  createEditorSearchQuery,
  dispatchEditorSearchQuery,
  editorSearchMatchInfo,
  selectEditorSearchMatchFromCursor,
  type EditorSearchDirection,
  type EditorSearchFocusRequest,
  type EditorSearchMatchInfo,
  type EditorSearchQueryOptions,
  DOCUMENT_SEARCH_DEBOUNCE_MS,
  SEARCH_DEBOUNCE_MS,
  SEED_SELECTION_MAX_CHARS,
  cancelIdle,
  requestIdle,
} from "./editor_search";

export type { EditorSearchDirection, EditorSearchFocusRequest } from "./editor_search";

interface EditorSearchPanelProps {
  view: EditorView | null;
  open: boolean;
  showReplace: boolean;
  readOnly: boolean;
  isMac: boolean;
  focusRequest: EditorSearchFocusRequest;
  documentText: string;
  onShowReplaceChange: (show: boolean) => void;
  onClose: () => void;
  navigateRef?: MutableRefObject<((direction: EditorSearchDirection) => void) | null>;
}

export function EditorSearchPanel({
  view,
  open,
  showReplace,
  readOnly,
  isMac,
  focusRequest,
  documentText,
  onShowReplaceChange,
  onClose,
  navigateRef,
}: EditorSearchPanelProps) {
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchInfo, setMatchInfo] = useState<EditorSearchMatchInfo>(EMPTY_EDITOR_SEARCH_MATCH_INFO);
  const [selectionLimited, setSelectionLimited] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);

  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const idleRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);
  const pendingSeedRef = useRef<string | null>(null);
  const focusTargetRef = useRef<"find" | "replace">("find");

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (idleRef.current !== null) {
      cancelIdle(idleRef.current);
      idleRef.current = null;
    }
  }, []);

  const queryOptions = useCallback(
    (): EditorSearchQueryOptions => ({
      search: searchText,
      replace: replaceText,
      caseSensitive,
      regexp: useRegex,
      wholeWord,
    }),
    [searchText, replaceText, caseSensitive, useRegex, wholeWord],
  );

  const scheduleMatches = useCallback(
    (options: EditorSearchQueryOptions, delay: number, autoSelect: boolean) => {
      if (!view) return;
      clearTimers();
      const query = dispatchEditorSearchQuery(view, options);
      setSelectionLimited(false);
      if (!options.search) {
        setMatchInfo(EMPTY_EDITOR_SEARCH_MATCH_INFO);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        idleRef.current = requestIdle(() => {
          idleRef.current = null;
          if (autoSelect) selectEditorSearchMatchFromCursor(view, query);
          setMatchInfo(editorSearchMatchInfo(view.state, query));
        });
      }, delay);
    },
    [view, clearTimers],
  );

  useEffect(() => {
    if (!open || !view) return;
    const options = queryOptions();
    if (!options.search) return;
    const query = createEditorSearchQuery(options);
    if (!query.valid) return;
    clearTimers();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      idleRef.current = requestIdle(() => {
        idleRef.current = null;
        setMatchInfo(editorSearchMatchInfo(view.state, query));
      });
    }, DOCUMENT_SEARCH_DEBOUNCE_MS);
    // `queryOptions` is intentionally omitted: it is read from the render in
    // which the document changed, and including it would re-run on typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentText, open, view, clearTimers]);

  useEffect(() => {
    if (!open || !view || composingRef.current) return;
    scheduleMatches(
      {
        search: searchText,
        replace: replaceText,
        caseSensitive,
        regexp: useRegex,
        wholeWord,
      },
      SEARCH_DEBOUNCE_MS,
      true,
    );
    // `replaceText` is intentionally omitted: editing the replacement must
    // not move the selection to the next match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, searchText, caseSensitive, useRegex, wholeWord, searchNonce, scheduleMatches]);

  useEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    if (!open) {
      clearTimers();
      setMatchInfo(EMPTY_EDITOR_SEARCH_MATCH_INFO);
      setSelectionLimited(false);
      return;
    }
    setSelectionLimited(false);
    if (!view) return;
    const selection = view.state.selection.main;
    if (selection.empty) return;
    const selected = view.state.sliceDoc(selection.from, selection.to);
    if (
      selected !== searchText &&
      selected &&
      !selected.includes("\n") &&
      selected.length <= SEED_SELECTION_MAX_CHARS
    ) {
      pendingSeedRef.current = selected;
      setSearchText(selected);
    }
    // `searchText` is read only on the open transition; adding it to the deps
    // would re-seed while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, clearTimers]);

  useEffect(() => {
    const pending = pendingSeedRef.current;
    if (!open || pending === null || searchText !== pending) return;
    pendingSeedRef.current = null;
    const input =
      focusTargetRef.current === "replace" ? replaceInputRef.current : findInputRef.current;
    input?.focus();
    input?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  useEffect(() => {
    if (!open) return;
    focusTargetRef.current = focusRequest.target;
    const input =
      focusRequest.target === "replace" ? replaceInputRef.current : findInputRef.current;
    input?.focus();
    input?.select();
  }, [open, focusRequest.token, focusRequest.target]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const goToMatch = (direction: EditorSearchDirection) => {
    if (!view) return;
    const query = createEditorSearchQuery(queryOptions());
    if (!query.valid) return;
    const moved = direction === "next" ? findNext(view) : findPrevious(view);
    if (moved) setMatchInfo(editorSearchMatchInfo(view.state, query));
  };
  useEffect(() => {
    if (!navigateRef) return;
    navigateRef.current = goToMatch;
    return () => {
      navigateRef.current = null;
    };
  });

  const replaceCurrent = () => {
    if (!view || readOnly) return;
    const query = createEditorSearchQuery(queryOptions());
    if (!query.valid) return;
    replaceNext(view);
    setMatchInfo(editorSearchMatchInfo(view.state, query));
  };

  const replaceEvery = () => {
    if (!view || readOnly) return;
    const query = createEditorSearchQuery(queryOptions());
    if (!query.valid) return;
    replaceAll(view);
    setMatchInfo(editorSearchMatchInfo(view.state, query));
  };

  const selectAllMatches = () => {
    if (!view) return;
    const query = createEditorSearchQuery(queryOptions());
    if (!query.valid) return;
    const matches = collectEditorSearchMatches(view.state, query, EDITOR_SEARCH_MATCH_LIMIT + 1);
    if (matches.length === 0) return;
    const limited = matches.length > EDITOR_SEARCH_MATCH_LIMIT;
    const selected = limited ? matches.slice(0, EDITOR_SEARCH_MATCH_LIMIT) : matches;
    view.dispatch({
      selection: EditorSelection.create(
        selected.map((match) => EditorSelection.range(match.from, match.to)),
      ),
      scrollIntoView: true,
    });
    setSelectionLimited(limited);
    setMatchInfo(editorSearchMatchInfo(view.state, query));
    view.focus();
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch(event.shiftKey ? "prev" : "next");
      return;
    }
    const key = event.key.toLowerCase();
    const replaceShortcut = isMac
      ? event.metaKey && event.altKey && !event.shiftKey && (key === "f" || event.keyCode === 70)
      : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "h";
    if (replaceShortcut) {
      event.preventDefault();
      if (readOnly) return;
      onShowReplaceChange(true);
      requestAnimationFrame(() => {
        replaceInputRef.current?.focus();
        replaceInputRef.current?.select();
      });
      return;
    }
    if (key === "f" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      findInputRef.current?.select();
    }
  };

  const handleReplaceKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      replaceCurrent();
    }
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const mod = isMac ? event.metaKey : event.ctrlKey;
    const stepKey = event.key === "F3" || (mod && !event.altKey && event.key.toLowerCase() === "g");
    if (!stepKey) return;
    event.preventDefault();
    goToMatch(event.shiftKey ? "prev" : "next");
  };

  const handleReplaceTextChange = (value: string) => {
    setReplaceText(value);
    if (!view || !open) return;
    dispatchEditorSearchQuery(view, {
      search: searchText,
      replace: value,
      caseSensitive,
      regexp: useRegex,
      wholeWord,
    });
  };

  const hasQuery = searchText.length > 0;
  const noMatches = hasQuery && matchInfo.total === 0;
  const canReplace = !readOnly && hasQuery && matchInfo.total > 0;
  const statusText = selectionLimited
    ? `Selected ${EDITOR_SEARCH_MATCH_LIMIT} matches (limit reached)`
    : hasQuery && matchInfo.total > 0
      ? `${matchInfo.index}/${matchInfo.total}${matchInfo.truncated ? "+" : ""}`
      : "No results";

  const canStep = hasQuery && matchInfo.total > 0;

  return (
    <FindBar
      label="Find and replace"
      hidden={!open}
      onKeyDown={handlePanelKeyDown}
      find={{
        value: searchText,
        onChange: setSearchText,
        inputRef: findInputRef,
        onKeyDown: handleSearchKeyDown,
        onCompositionStart: () => {
          composingRef.current = true;
        },
        onCompositionEnd: () => {
          composingRef.current = false;
          setSearchNonce((value) => value + 1);
        },
      }}
      caseSensitive={caseSensitive}
      onCaseSensitive={() => setCaseSensitive((value) => !value)}
      wholeWord={wholeWord}
      onWholeWord={() => setWholeWord((value) => !value)}
      regex={useRegex}
      onRegex={() => setUseRegex((value) => !value)}
      count={statusText}
      empty={noMatches}
      canStep={canStep}
      onPrevious={() => goToMatch("prev")}
      onNext={() => goToMatch("next")}
      onSelectAll={selectAllMatches}
      onClose={onClose}
      replace={
        readOnly
          ? undefined
          : {
              open: showReplace,
              onToggle: () => onShowReplaceChange(!showReplace),
              canReplace,
              onReplace: replaceCurrent,
              onReplaceAll: replaceEvery,
              value: replaceText,
              onChange: handleReplaceTextChange,
              inputRef: replaceInputRef,
              onKeyDown: handleReplaceKeyDown,
              onCompositionStart: () => {
                composingRef.current = true;
              },
              onCompositionEnd: () => {
                composingRef.current = false;
              },
            }
      }
    />
  );
}
