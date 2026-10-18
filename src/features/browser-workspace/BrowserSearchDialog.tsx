import { accountScopeWillResetEvent } from "@/features/auth";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight } from "lucide-react";
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
} from "@/shared/ui";
import { browserSearchEngine } from "@/features/workspace/browserSearchEngine";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { browserSearchDestination, useBrowserSearchStore, type SearchAnchor } from "./search";
import { SearchResultList, type SearchListItem } from "./SearchResultList";
import { openInNewBrowserTab, openMatch, openTargetBeside } from "./searchTargets";
import { useSearchItems } from "./useSearchItems";

/** Margins that put the panel's top-left corner where the address bar was. */
function overAddressBar(anchor: SearchAnchor) {
  return { marginLeft: anchor.left, marginTop: anchor.top, width: anchor.width };
}

const close = () => useBrowserSearchStore.getState().close();

export function BrowserSearchDialog() {
  const open = useBrowserSearchStore((state) => state.open);
  const anchor = useBrowserSearchStore((state) => state.anchor);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const { items } = useSearchItems(query, open);
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
      setQuery("");
      setError(null);
      setNotice(null);
    }
    return () => setBrowserWebviewsSuspended(false, "browser-search");
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);
  // Slower sources can shorten the list under the highlight.
  const active = Math.min(activeIndex, Math.max(0, items.length - 1));

  const changeQuery = (value: string) => {
    setError(null);
    setNotice(null);
    setQuery(value);
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

  /** ⌘⏎: the choice opens beside the current pane. */
  const chooseBeside = (item: SearchListItem | undefined) => {
    if (!item) {
      const url = browserSearchDestination(query);
      if (url) run(() => openTargetBeside({ url }));
      return;
    }
    if (item.type === "match" && item.match.target.type === "navigate")
      return run(() => openTargetBeside({ url: item.match.target.url }));
    choose(item);
  };

  const choose = (item: SearchListItem) => {
    if (item.type === "match") {
      const target = item.match.target;
      if (anchor && target.type !== "switch-tab" && target.type !== "open-in-app")
        run(() => anchor.openUrl(target.url));
      else run(() => openMatch(item.match, navigate));
    }
  };

  /** Enter with nothing highlighted: the typed address, or the typed search. */
  const submitText = () => {
    const url = browserSearchDestination(query);
    if (url) run(() => (anchor ? anchor.openUrl(url) : openInNewBrowserTab(url, navigate)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      chooseBeside(query.trim() || activeIndex > 0 ? items[active] : undefined);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + items.length) % items.length);
    }
  };

  const canSubmit = Boolean(query.trim() || items.length);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? useBrowserSearchStore.getState().show() : close())}
    >
      <DialogContent
        placement="top"
        backdrop={!anchor}
        // Unanchored, it opens in the middle of the window, whatever the panes are doing.
        style={anchor ? overAddressBar(anchor) : undefined}
        className={cn(
          anchor ? "max-w-none" : "max-w-[700px]",
          "gap-0 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 p-0",
          "ring-0 shadow-[0_24px_70px_rgba(0,0,0,0.65)] [&>[data-slot=dialog-close]]:hidden",
        )}
      >
        <DialogTitle className="sr-only">Search or enter a URL</DialogTitle>
        <DialogDescription className="sr-only">
          Enter opens a website or a {engine} search; Command-Enter opens it beside this page.
          Escape closes.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const item = query.trim() || activeIndex > 0 ? items[active] : undefined;
            if (item) choose(item);
            else submitText();
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <Search size={16} className="shrink-0 text-zinc-400" aria-hidden="true" />
            <Input
              variant="bare"
              autoFocus
              aria-label="Search or enter a URL"
              placeholder={`Search ${engine} or enter a URL`}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
              className="flex-1 text-zinc-100 placeholder:text-zinc-500"
            />
            <IconButton
              label="Open in new tab"
              type="submit"
              disabled={!canSubmit}
              className="sr-only"
            >
              <ArrowUpRight size={18} />
            </IconButton>
          </div>
          <div className="border-b border-white/[0.08]" />
          {error && (
            <p role="alert" className="px-4 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="px-4 py-2 text-xs text-zinc-400">
              {notice}
            </p>
          )}
        </form>
        <SearchResultList
          items={items}
          activeIndex={active}
          onHover={setActiveIndex}
          onChoose={choose}
        />
      </DialogContent>
    </Dialog>
  );
}
