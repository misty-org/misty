import { lazy, Suspense } from "react";
import { cn } from "@/shared/ui";
import type { EditorGroup as EditorGroupState } from "../store/useCodingWorkspaceStore";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { CodeTabs } from "./CodeTabs";

const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({ default: module.CodeEditor })),
);

interface EditorGroupProps {
  group: EditorGroupState;
  isFocused: boolean;
  canSplit: boolean;
  rootPath: string;
}

export function EditorGroupPane({ group, isFocused, canSplit, rootPath }: EditorGroupProps) {
  const setActiveGroup = useCodingWorkspaceStore((state) => state.setActiveGroup);
  const activeTab = group.activeTabPath
    ? (group.tabs.find((tab) => tab.path === group.activeTabPath) ?? null)
    : null;

  return (
    <div
      onMouseDownCapture={() => setActiveGroup(group.id)}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-charcoal-bg",
        isFocused ? "" : "opacity-[0.98]",
      )}
    >
      <CodeTabs group={group} isFocused={isFocused} canSplit={canSplit} />
      <div className="min-h-0 flex-1">
        {activeTab ? (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-charcoal-bg text-xs italic text-cream-muted">
                Opening {activeTab.name}…
              </div>
            }
          >
            <CodeEditor tab={activeTab} groupId={group.id} />
          </Suspense>
        ) : (
          <EmptyEditor rootPath={rootPath} />
        )}
      </div>
    </div>
  );
}

function EmptyEditor({ rootPath }: { rootPath: string }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-center text-sm text-cream-muted">
      <div>
        <p>Open a file from the explorer to start editing.</p>
        <p className="mt-2 text-xs text-cream-muted/70">
          <span className="font-mono">{rootPath}</span>
        </p>
      </div>
    </div>
  );
}
