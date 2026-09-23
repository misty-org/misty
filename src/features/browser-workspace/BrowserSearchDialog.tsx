import { accountScopeWillResetEvent } from "@/features/auth";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { browserSearchDestination, useBrowserSearchStore } from "./search";

export function BrowserSearchDialog() {
  const open = useBrowserSearchStore((state) => state.open);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
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
      setQuery("");
      setError(null);
    }
    return () => setBrowserWebviewsSuspended(false, "browser-search");
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) =>
        next ? useBrowserSearchStore.getState().show() : useBrowserSearchStore.getState().close()
      }
    >
      <DialogContent className="top-[24%] max-w-[620px] gap-3 p-4 pt-3">
        <DialogTitle className="pr-8 text-sm">Search or enter a URL</DialogTitle>
        <DialogDescription className="sr-only">
          Enter opens a website or Google search in a new workspace tab. Escape closes search.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const url = browserSearchDestination(query);
              if (!url) return;
              const tab = useWorkspaceStore.getState().openBrowserTab({ url });
              useBrowserSearchStore.getState().close();
              navigate(tab.route, { replace: true });
            } catch {
              setError("That address could not be opened. Check it and try again.");
            }
          }}
        >
          <div className="flex items-center gap-2">
            <Search size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
            <Input
              autoFocus
              aria-label="Search or enter a URL"
              placeholder="Search Google or enter a URL"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              disabled={!query.trim()}
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
        <p className="text-xs text-cream-muted">Enter to open · Esc to close</p>
      </DialogContent>
    </Dialog>
  );
}
