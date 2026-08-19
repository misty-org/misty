import { SplitSquareHorizontal, X } from "lucide-react";
import { cn } from "@/shared/ui";
import type { EditorGroup } from "../store/useCodingWorkspaceStore";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

interface CodeTabsProps {
  group: EditorGroup;
  isFocused: boolean;
  canSplit: boolean;
}

export function CodeTabs({ group, isFocused, canSplit }: CodeTabsProps) {
  const setActiveTab = useCodingWorkspaceStore((state) => state.setActiveTab);
  const closeTab = useCodingWorkspaceStore((state) => state.closeTab);
  const splitActiveTab = useCodingWorkspaceStore((state) => state.splitActiveTab);

  return (
    <div className="flex h-[34px] items-stretch overflow-hidden border-b border-charcoal-border bg-charcoal-sidebar">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {group.tabs.map((tab) => {
          const isActive = tab.path === group.activeTabPath;
          const isDirty = tab.contents !== tab.savedContents;
          return (
            <div
              key={tab.path}
              className={cn(
                "group relative flex max-w-[240px] shrink-0 items-center gap-2 border-r border-charcoal-border pl-3 pr-2",
                "font-mono text-[12px]",
                isActive ? "bg-charcoal-bg text-cream-bright" : "text-cream-muted hover:text-cream",
              )}
            >
              {isActive && isFocused ? (
                <span className="absolute inset-x-3 top-0 h-[2px] bg-[#e8d9c0]" aria-hidden />
              ) : isActive ? (
                <span className="absolute inset-x-3 top-0 h-[2px] bg-charcoal-active" aria-hidden />
              ) : null}
              <button
                type="button"
                onClick={() => setActiveTab(group.id, tab.path)}
                title={tab.path}
                className="min-w-0 truncate py-2 text-left"
              >
                {tab.name}
              </button>
              <button
                type="button"
                onClick={() => closeTab(group.id, tab.path)}
                aria-label={`Close ${tab.name}`}
                className="grid size-4 place-items-center rounded text-cream-muted/60 hover:bg-charcoal-hover hover:text-cream"
              >
                {isDirty ? (
                  <span className="text-[14px] leading-none text-[#e8d9c0] group-hover:hidden">
                    ●
                  </span>
                ) : null}
                <X size={11} className={cn(isDirty && "hidden group-hover:block")} />
              </button>
            </div>
          );
        })}
      </div>
      {canSplit ? (
        <button
          type="button"
          onClick={() => splitActiveTab()}
          disabled={group.tabs.length === 0}
          aria-label="Split editor right"
          title="Split editor right (⌘\\)"
          className="grid w-9 place-items-center border-l border-charcoal-border text-cream-muted hover:bg-charcoal-hover hover:text-cream disabled:opacity-30"
        >
          <SplitSquareHorizontal size={13} />
        </button>
      ) : null}
    </div>
  );
}
