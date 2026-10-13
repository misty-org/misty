import { activeLayoutView, paneViewLabel } from "@/features/workspace/layoutTabs";
import { useWorkspaceStore } from "@/features/workspace";
import type { WorkspacePane, WorkspaceTab, WorkspaceView } from "@/features/workspace/model";
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, MenuTrigger } from "@/shared/ui";
import { Blocks, ChevronDown, X } from "lucide-react";
import { ViewIcon } from "./WorkspaceViewGroupButton";

/** Dropdown on a split tab that lists its panes, to focus or close one. */
export function WorkspaceTabStripPaneMenu({
  tab,
  panes,
  label,
  onOpen,
}: {
  tab: WorkspaceTab;
  panes: WorkspacePane[];
  label: string;
  onOpen(view: WorkspaceView): void;
}) {
  return (
    <DropdownMenu modal={false}>
      <MenuTrigger
        iconOnly
        size="xs"
        className="mr-0.5"
        label={`Show panes in ${label}`}
        aria-description={`${panes.length} panes`}
        icon={<ChevronDown className="size-3" size={12} />}
      />
      <DropdownMenuContent align="start" width="md" className="max-w-[calc(100vw-24px)]">
        {panes.map((item) => {
          const itemView = item.views[0];
          if (!itemView) return null;
          const focused = item.id === tab.focusedPaneId;
          return (
            <div key={item.id} className="flex items-center gap-1">
              <DropdownMenuItem
                className={cn(
                  "min-w-0 flex-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cream-muted",
                  focused && [
                    "bg-charcoal-active text-cream-bright hover:bg-charcoal-active",
                    "focus:bg-charcoal-active focus-visible:bg-charcoal-active",
                    "data-highlighted:bg-charcoal-active",
                  ],
                )}
                aria-current={focused ? "true" : undefined}
                aria-label={`${paneViewLabel(itemView)}${focused ? ", active pane" : ""}`}
                onSelect={() => {
                  useWorkspaceStore.getState().focusView(itemView.id);
                  onOpen(itemView);
                }}
              >
                <ViewIcon tab={itemView.placeholder ? undefined : itemView} icon={Blocks} />
                <span className="min-w-0 flex-1 truncate">{paneViewLabel(itemView)}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Close pane ${paneViewLabel(itemView)}`}
                className="w-8 shrink-0 justify-center px-0"
                onSelect={() => {
                  if (!useWorkspaceStore.getState().closeView(itemView.id)) return;
                  const current = activeLayoutView(useWorkspaceStore.getState().layout);
                  if (current) onOpen(current);
                }}
              >
                <X size={14} aria-hidden />
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
