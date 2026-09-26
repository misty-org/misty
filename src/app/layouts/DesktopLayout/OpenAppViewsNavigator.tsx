import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { NavigationTreeItem } from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace";
import { allLayoutViews, activeLayoutView } from "@/features/workspace/layoutTabs";
import { currentVirtualWindows } from "@/features/workspace/virtualWindows";
import { Folder, SquareTerminal } from "lucide-react";

/** Focus live views by identity so two projects with the same app route stay distinct. */
export function OpenAppViewsNavigator({ appId }: { appId: "code" | "terminal" }) {
  const navigate = useNavigate();
  const views = useWorkspaceStore(
    useShallow((state) =>
      currentVirtualWindows(state)
        .flatMap((window) => allLayoutViews(window.layout))
        .filter((view) => view.groupKey === `app:${appId}` && !view.placeholder),
    ),
  );
  const activeId = useWorkspaceStore((state) => activeLayoutView(state.layout)?.id);

  const displayViews = views.filter((view) => {
    if (appId === "code" && views.length === 1 && (!view.title || view.title === "Code")) {
      return false;
    }
    return true;
  });

  if (!displayViews.length)
    return (
      <p className="px-5 py-2 text-xs text-cream-muted">
        {appId === "code" ? "No open workspaces." : "No open sessions."}
      </p>
    );

  const IconComponent = appId === "code" ? Folder : SquareTerminal;

  return (
    <div
      role="group"
      aria-label={`${appId === "code" ? "Code" : "Terminal"} destinations`}
      className="grid gap-1"
    >
      {displayViews.map((view) => {
        const rawTitle = view.title || (appId === "code" ? "Workspace" : "Terminal");
        const label = appId === "terminal" ? rawTitle.replace(/^Terminal · /, "") : rawTitle;

        return (
          <NavigationTreeItem
            key={view.id}
            icon={<IconComponent size={16} className="text-cream-muted" />}
            label={label}
            selected={activeId === view.id}
            onClick={() => {
              if (useWorkspaceStore.getState().focusTab(view.id)) navigate(view.route);
            }}
          />
        );
      })}
    </div>
  );
}
