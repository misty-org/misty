import { accountScopeWillResetEvent } from "@/features/auth";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight, Loader2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { openFilesTabRevealing } from "@/features/files/workspace/explorer/workspace/explorerWorkspace/filesTabReveal";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { browserSearchDestination, useBrowserSearchStore } from "./search";
import {
  matchingSearchCommands,
  parseSearchCommand,
  searchCommandFor,
  type SearchScope,
} from "./searchCommands";
import { SearchResultList, type SearchListItem } from "./SearchResultList";
import { useScopedSearch, type ScopedSearchResult } from "./useScopedSearch";

export function BrowserSearchDialog() {
  const open = useBrowserSearchStore((state) => state.open);
  const [scope, setScope] = useState<SearchScope>("browser");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { results, loading } = useScopedSearch(scope, query);
  const command = searchCommandFor(scope);
  const suggestions = scope === "browser" ? matchingSearchCommands(query) : [];
  const items: SearchListItem[] = suggestions.length
    ? suggestions.map((entry) => ({ type: "command", command: entry }))
    : results.map((result) => ({ type: "result", result }));

  useEffect(() => {
    const close = () => useBrowserSearchStore.getState().close();
    window.addEventListener(accountScopeWillResetEvent, close);
    return () => {
      window.removeEventListener(accountScopeWillResetEvent, close);
      close();
    };
  }, []);

  useEffect(() => {
    setBrowserWebviewsSuspended(open, "browser-search");
    if (!open) {
      setScope("browser");
      setQuery("");
      setError(null);
    }
    return () => setBrowserWebviewsSuspended(false, "browser-search");
  }, [open]);

  useEffect(() => setActiveIndex(0), [scope, query, results]);

  const changeQuery = (value: string) => {
    setError(null);
    const parsed = parseSearchCommand(value);
    if (parsed) {
      setScope(parsed.scope);
      setQuery(parsed.query);
    } else setQuery(value);
  };

  const openResult = (result: ScopedSearchResult) => {
    useBrowserSearchStore.getState().close();
    if (result.target.kind === "route") {
      navigate(result.target.route);
      return;
    }
    if (result.target.kind === "agent") {
      useMistyStore.setState({
        selectedAgentId: result.target.agentId,
        activeConversationId: result.target.conversationId,
      });
      navigate(`/agents?agent=${encodeURIComponent(result.target.agentId)}`);
      return;
    }
    navigate(openFilesTabRevealing(result.target.result));
  };

  const choose = (item: SearchListItem) => {
    if (item.type === "command") {
      setScope(item.command.scope);
      setQuery("");
    } else openResult(item.result);
  };

  const openBrowser = () => {
    try {
      const url = browserSearchDestination(query);
      if (!url) return;
      const tab = useWorkspaceStore.getState().openBrowserTab({ url });
      useBrowserSearchStore.getState().close();
      navigate(tab.route, { replace: true });
    } catch {
      setError("That address could not be opened. Check it and try again.");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !query && scope !== "browser") {
      event.preventDefault();
      setScope("browser");
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + items.length) % items.length);
    } else if (event.key === "Tab" && suggestions.length) {
      event.preventDefault();
      choose(items[activeIndex]);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) =>
        next ? useBrowserSearchStore.getState().show() : useBrowserSearchStore.getState().close()
      }
    >
      <DialogContent className="top-[24%] max-w-[620px] gap-3 p-4 pt-3">
        <DialogTitle className="pr-8 text-sm">
          {scope === "browser" ? "Search or enter a URL" : `Search ${command.label}`}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Enter opens a website or Google search in a new workspace tab. Type /files, /spaces, or
          /agents to search those instead. Escape closes search.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const item = items[activeIndex];
            if (item) choose(item);
            else if (scope === "browser") openBrowser();
          }}
        >
          <div className="flex items-center gap-2">
            {loading ? (
              <Loader2
                size={18}
                className="shrink-0 animate-spin text-cream-muted"
                aria-hidden="true"
              />
            ) : (
              <Search size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
            )}
            {scope !== "browser" && (
              <span className="shrink-0 rounded-md bg-accent px-2 py-1 font-mono text-xs">
                {command.command}
              </span>
            )}
            <Input
              autoFocus
              aria-label="Search or enter a URL"
              placeholder={command.placeholder}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              disabled={scope === "browser" ? !query.trim() && !items.length : !items.length}
              aria-label="Open in new tab"
            >
              <ArrowUpRight size={18} />
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <SearchResultList
          items={items}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onChoose={choose}
        />
        {scope !== "browser" && query.trim() && !loading && !items.length && (
          <p className="text-sm text-cream-muted">No matches in {command.label.toLowerCase()}.</p>
        )}
        <p className="text-xs text-cream-muted">
          Enter to open · Type / for commands · Esc to close
        </p>
      </DialogContent>
    </Dialog>
  );
}
