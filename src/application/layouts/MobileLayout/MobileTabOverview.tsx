import {
  WorkspaceAppIcon,
  toolIdFromTab,
  type WorkspaceTabProjection,
  type WorkspaceWindowProjection,
} from "@/features/workspace/core";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, cn } from "@/shared/ui";
import { Layers3, Plus, X } from "lucide-react";

export function MobileTabOverview(props: {
  open: boolean;
  windows: WorkspaceWindowProjection[];
  activeWindowId: string;
  activeTabId?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: WorkspaceTabProjection) => void;
  onCloseTab: (entry: WorkspaceTabProjection) => void;
  onCreateWindow: () => void;
}) {
  const tabCount = props.windows.reduce((total, group) => total + group.tabs.length, 0);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="h-dvh max-h-none gap-0 rounded-none border-x-0 border-b-0 bg-charcoal-bg p-0 pt-[env(safe-area-inset-top)]"
        data-mobile-tab-overview
      >
        <SheetHeader className="border-b border-charcoal-border px-4 py-3 text-left">
          <SheetTitle className="text-lg tracking-[-0.02em]">Tabs</SheetTitle>
          <SheetDescription>
            {formatCount(tabCount, "tab")} in {formatCount(props.windows.length, "window")}
          </SheetDescription>
        </SheetHeader>

        <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-5 min-[700px]:px-6">
          <div className="mx-auto grid w-full max-w-5xl gap-8">
            {props.windows.map((group) => (
              <section key={group.window.id} aria-labelledby={`mobile-window-${group.window.id}`}>
                <div className="mb-3 flex min-h-11 items-center gap-2 px-1">
                  <Layers3 size={19} className="shrink-0 text-cream-muted" aria-hidden="true" />
                  <h2
                    id={`mobile-window-${group.window.id}`}
                    className="min-w-0 flex-1 truncate text-[15px] font-semibold text-cream-bright"
                  >
                    {group.window.title}
                  </h2>
                  <span className="shrink-0 text-xs text-cream-muted">
                    {group.window.id === props.activeWindowId ? "Current · " : ""}
                    {formatCount(group.tabs.length, "tab")}
                  </span>
                </div>

                {group.tabs.length ? (
                  <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3 min-[1100px]:grid-cols-4">
                    {group.tabs.map((entry) => (
                      <TabPreview
                        key={entry.tab.id}
                        entry={entry}
                        active={entry.tab.id === props.activeTabId}
                        onSelect={props.onSelect}
                        onClose={props.onCloseTab}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid min-h-32 place-items-center rounded-xl border border-charcoal-border px-5 text-center text-sm text-cream-muted">
                    This window only contains desktop tabs.
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>

        <footer className="absolute inset-x-0 bottom-0 grid min-h-16 grid-cols-[1fr_auto] items-center border-t border-charcoal-border bg-charcoal-workspace px-3 pb-[env(safe-area-inset-bottom)]">
          <button
            type="button"
            className="flex min-h-11 w-fit items-center gap-2 rounded-lg px-3 text-sm font-medium text-cream-bright active:bg-charcoal-card"
            onClick={props.onCreateWindow}
          >
            <Plus size={20} aria-hidden="true" />
            New window
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-cream-bright active:bg-charcoal-card"
            onClick={() => props.onOpenChange(false)}
          >
            Done
          </button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function TabPreview(props: {
  entry: WorkspaceTabProjection;
  active: boolean;
  onSelect: (entry: WorkspaceTabProjection) => void;
  onClose: (entry: WorkspaceTabProjection) => void;
}) {
  const toolId = toolIdFromTab(props.entry.tab);
  return (
    <article
      className={cn(
        "relative min-w-0 overflow-hidden rounded-xl border bg-charcoal-card",
        props.active ? "border-cream-muted" : "border-charcoal-border",
      )}
    >
      <button
        type="button"
        aria-label={`Close ${props.entry.tab.title}`}
        className="absolute right-1 top-1 z-10 grid size-11 place-items-center rounded-lg text-cream-muted active:bg-charcoal-active active:text-cream-bright"
        onClick={() => props.onClose(props.entry)}
      >
        <span className="grid size-7 place-items-center rounded-full bg-charcoal-bg">
          <X size={16} aria-hidden="true" />
        </span>
      </button>
      <button
        type="button"
        aria-current={props.active ? "page" : undefined}
        className="block w-full text-left"
        onClick={() => props.onSelect(props.entry)}
      >
        <span className="block aspect-[4/3] border-b border-charcoal-border bg-charcoal-bg px-4 pb-4 pt-14">
          <span className="grid h-full place-items-center rounded-lg bg-charcoal-workspace">
            <WorkspaceAppIcon appId={toolId} size="marketplace" />
          </span>
        </span>
        <span className="flex min-h-16 items-center gap-2 px-3">
          <WorkspaceAppIcon appId={toolId} size="picker" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-cream-bright">
              {props.entry.tab.title}
            </span>
            <span className="mt-0.5 block truncate text-xs text-cream-muted">
              {surfaceLabel(toolId)}
            </span>
          </span>
        </span>
      </button>
    </article>
  );
}

function surfaceLabel(toolId: ReturnType<typeof toolIdFromTab>): string {
  if (toolId === "social") return "Chat";
  return toolId.charAt(0).toUpperCase() + toolId.slice(1);
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
