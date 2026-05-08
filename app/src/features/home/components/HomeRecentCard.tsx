import { useWorkspaceStore } from "@/features/workspace";
import { Card, CardContent, CardHeader, CardTitle, cn } from "@/shared/ui";
import {
  ArrowLeftRight,
  Blocks,
  Bot,
  Code2,
  FolderOpen,
  Globe2,
  History,
  LayoutGrid,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatRelative } from "../homeFormat";
import type { HomeRecent } from "../useHomeRecents";

const rowClass = [
  "grid w-full min-h-[52px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3",
  "border-b border-charcoal-border/60 px-5 py-2 text-left transition-colors",
  "last:border-b-0 hover:bg-charcoal-hover/55",
].join(" ");

export function HomeRecentCard({ items }: { items: HomeRecent[] }) {
  const navigate = useNavigate();

  const reopen = (recent: HomeRecent) => {
    const workspace = useWorkspaceStore.getState();
    // The tab may live in another Space's layout, so switch scope before
    // focusing — otherwise focusTab finds nothing and the click does nothing.
    if (recent.scopeKey !== workspace.activeScopeKey) {
      workspace.setScope(recent.scopeKey as Parameters<typeof workspace.setScope>[0]);
    }
    useWorkspaceStore.getState().focusTab(recent.id);
    navigate(recent.route);
  };

  return (
    <Card className="gap-0 bg-charcoal-card/70 py-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-charcoal-border/70 px-5 py-4">
        <CardTitle className="text-base font-semibold text-cream-bright">Recent</CardTitle>
        <History className="size-4 text-cream-muted" strokeWidth={1.8} />
      </CardHeader>
      <CardContent className="px-0">
        {items.length ? (
          items.map((item) => {
            const Icon = recentIcon(item.surfaceId);
            return (
              <button
                type="button"
                key={`${item.scopeKey}:${item.id}`}
                className={cn(rowClass)}
                onClick={() => reopen(item)}
              >
                <span className="grid size-7 place-items-center rounded-md bg-charcoal-bg text-cream-muted">
                  <Icon className="size-4" strokeWidth={1.8} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-cream">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-cream-muted">{item.subtitle}</span>
                </span>
                <span className="text-xs tabular-nums text-cream-muted">
                  {formatRelative(item.lastFocusedAt)}
                </span>
              </button>
            );
          })
        ) : (
          <div className="grid min-h-[140px] place-items-center text-center">
            <div>
              <History className="mx-auto size-5 text-cream-muted" strokeWidth={1.7} />
              <p className="mt-2 text-sm text-cream-muted">Nothing opened yet.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function recentIcon(surfaceId: HomeRecent["surfaceId"]): LucideIcon {
  if (surfaceId === "browser") return Globe2;
  if (surfaceId === "terminal") return SquareTerminal;
  if (surfaceId === "code") return Code2;
  if (surfaceId === "files") return FolderOpen;
  if (surfaceId === "transfers") return ArrowLeftRight;
  if (surfaceId === "agents") return Bot;
  if (surfaceId === "extensions") return Blocks;
  return LayoutGrid;
}
