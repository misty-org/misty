import { accountScopeWillResetEvent } from "@/features/auth";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  SkeletonList,
  Spinner,
} from "@/shared/ui";
import { browserSearchEngine } from "@/features/workspace/browserSearchEngine";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { bangDestination, parseBang, parseLeadingBang } from "./bangs/parse";
import type { Bang } from "./bangs/types";
import { browserSearchDestination, useBrowserSearchStore } from "./search";
import { SearchResultList, type SearchListItem } from "./SearchResultList";
import { openInNewBrowserTab, openMatch, openResult } from "./searchTargets";
import { useSearchItems } from "./useSearchItems";

const close = () => useBrowserSearchStore.getState().close();

export function BrowserSearchDialog() {
  const open = useBrowserSearchStore((state) => state.open);
  const [bang, setBang] = useState<Bang | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const { items, bangs, loading } = useSearchItems(bang, query, open);
  const engine = browserSearchEngine().name;

  useEffect(() => {
    window.addEventListener(accountScopeWillResetEvent, close);
    return () => {
      window.removeEventListener(accountScopeWillResetEvent, close);
      close();
    };
  }, []);

  useEffect(() => {
    setBrowserWebviewsSuspended(open, "browser-search");
    if (!open) {
      setBang(null);
      setQuery("");
      setError(null);
      setNotice(null);
    }
    return () => setBrowserWebviewsSuspended(false, "browser-search");
  }, [open]);

  useEffect(() => setActiveIndex(0), [bang, query]);
  // Slower sources can shorten the list under the highlight.
  const active = Math.min(activeIndex, Math.max(0, items.length - 1));

  const changeQuery = (value: string) => {
    setError(null);
    setNotice(null);
    const parsed = bang ? null : parseLeadingBang(value, bangs);
    if (parsed) {
      setBang(parsed.bang);
      setQuery(parsed.query);
    } else setQuery(value);
  };

  const pickBang = (next: Bang, carried = "") => {
    setBang(next);
    setQuery(carried);
    setNotice(null);
  };

  const run = (action: () => string | void) => {
    try {
      const message = action();
      if (message) setNotice(message);
      else close();
    } catch {
      setError("That address could not be opened. Check it and try again.");
    }
  };

  const choose = (item: SearchListItem) => {
    if (item.type === "bang") pickBang(item.bang, item.query);
    else if (item.type === "match") run(() => openMatch(item.match, navigate));
    else run(() => openResult(item.result, navigate));
  };

  /** Enter with nothing highlighted: a website shortcut's search, or the typed address or search. */
  const submitText = () => {
    if (bang?.kind === "scope") return;
    const parsed = bang ? { bang, query } : parseBang(query, bangs);
    if (parsed?.bang.kind === "scope") return pickBang(parsed.bang, parsed.query);
    const url =
      parsed?.bang.kind === "web"
        ? bangDestination(parsed.bang, parsed.query)
        : browserSearchDestination(query);
    if (url) run(() => openInNewBrowserTab(url, navigate));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !query && bang) {
      event.preventDefault();
      setBang(null);
      setNotice(null);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + items.length) % items.length);
    } else if (event.key === "Tab" && items[active]?.type === "bang") {
      event.preventDefault();
      choose(items[active]);
    }
  };

  const placeholder = !bang
    ? `Search ${engine} or enter a URL`
    : bang.kind === "scope"
      ? bang.placeholder
      : `Search ${bang.label}`;
  const canSubmit =
    bang?.kind === "scope" ? items.length > 0 : Boolean(query.trim() || items.length || bang);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? useBrowserSearchStore.getState().show() : close())}
    >
      <DialogContent placement="top" className="max-w-[620px] gap-3 p-4 pt-3">
        <DialogTitle className="pr-8 text-sm">
          {bang ? `Search ${bang.label}` : "Search or enter a URL"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Enter opens a website or a {engine} search in a new workspace tab. Type an exclamation
          mark for shortcuts, such as !files, !bookmarks or !yt, to search there instead. Escape
          closes search.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const item = items[active];
            if (item) choose(item);
            else submitText();
          }}
        >
          <div className="flex items-center gap-2">
            {loading ? (
              <Spinner size="lg" label={false} className="text-cream-muted" />
            ) : (
              <Search size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
            )}
            {bang && (
              <span className="shrink-0 rounded-md bg-accent px-2 py-1 font-mono text-xs">
                !{bang.trigger}
              </span>
            )}
            <Input
              autoFocus
              aria-label="Search or enter a URL"
              placeholder={placeholder}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1"
            />
            <IconButton label="Open in new tab" type="submit" disabled={!canSubmit}>
              <ArrowUpRight size={18} />
            </IconButton>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-2 text-sm text-cream-muted">
              {notice}
            </p>
          )}
        </form>
        {loading && !items.length ? (
          <SkeletonList label={`Searching ${bang?.label ?? ""}`} rows={3} lines={1} />
        ) : (
          <SearchResultList
            items={items}
            activeIndex={active}
            onHover={setActiveIndex}
            onChoose={choose}
          />
        )}
        {bang?.kind === "scope" && query.trim() && !loading && !items.length && (
          <p className="text-sm text-cream-muted">No matches in {bang.label.toLowerCase()}.</p>
        )}
        <p className="text-xs text-cream-muted">
          Enter to open · Type ! for shortcuts · Esc to close
        </p>
      </DialogContent>
    </Dialog>
  );
}
