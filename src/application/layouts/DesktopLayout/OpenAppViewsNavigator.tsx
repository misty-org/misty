import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { NavigationTreeItem } from "@/shared/ui";
import { useWorkspaceStore, WorkspaceAppIcon } from "@/features/workspace";
import { allLayoutViews, activeLayoutView } from "@/features/workspace/layoutTabs";
import { currentVirtualWindows } from "@/features/workspace/virtualWindows";

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
  if (!views.length)
    return (
      <p className="px-5 py-2 text-xs text-cream-muted">
        {appId === "code" ? "No open workspaces." : "No open sessions."}
      </p>
    );
  return (
    <div
      role="group"
      aria-label={`${appId === "code" ? "Code" : "Terminal"} destinations`}
      className="grid gap-1"
    >
      {views.map((view, index) => (
        <NavigationTreeItem
          key={view.id}
          icon={<WorkspaceAppIcon appId={appId} size="nav" />}
          label={view.title || (appId === "code" ? "Workspace" : "Terminal")}
          selected={activeId === view.id}
          last={index === views.length - 1}
          onClick={() => {
            if (useWorkspaceStore.getState().focusTab(view.id)) navigate(view.route);
          }}
        />
      ))}
    </div>
  );
}
