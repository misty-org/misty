import { useGlobalSearchStore } from "@/features/global-search";
import { useWorkspaceStore } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { CornerDownLeft, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { parseHomeCommand } from "../homeCommand";

/**
 * The one thing you can *do* from Home.
 *
 * Everything else on this page reports state; this starts work. It routes on
 * the shape of the input rather than making you choose a tool first — see
 * `parseHomeCommand`.
 */
export function HomeCommandInput() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  const run = (event: FormEvent) => {
    event.preventDefault();
    const command = parseHomeCommand(value);
    if (!command) return;
    const workspace = useWorkspaceStore.getState();

    if (command.kind === "url") {
      const tab = workspace.openBrowserTab({ url: command.url });
      workspace.focusTab(tab.id);
      navigate(tab.route);
    } else if (command.kind === "path") {
      const tab = workspace.openSurface({
        surfaceId: "files",
        groupKey: "tool:files",
        title: "Files",
        route: "/files",
        instancePolicy: "single",
        state: { version: 1, path: command.path },
      });
      navigate(tab.route);
    } else {
      // Search and ask share one launcher; the mode is the only difference.
      const search = useGlobalSearchStore.getState();
      search.setMode(command.kind === "ask" ? "ask" : "search");
      search.setQuery(command.query);
      search.openPanel();
      void search.submit();
    }
    setValue("");
  };

  return (
    <form onSubmit={run} role="search">
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border bg-charcoal-card/70 px-4 transition-colors",
          focused ? "border-charcoal-active" : "border-charcoal-border",
        )}
      >
        <Search className="size-4 shrink-0 text-cream-muted" strokeWidth={1.8} />
        <input
          className={cn(
            "h-12 min-w-0 flex-1 border-0 bg-transparent text-sm text-cream outline-none",
            "placeholder:text-cream-muted",
          )}
          value={value}
          placeholder="Search, ask a question, paste a link, or type a path"
          aria-label="Search, ask, or open"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {value.trim() ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-cream-muted">
            <CornerDownLeft className="size-3" strokeWidth={2} />
          </span>
        ) : null}
      </div>
    </form>
  );
}
