import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRightLeft, FolderOpen, Folders } from "lucide-react";
import { transfersPath } from "@/features/files/transfers";
import {
  activeLayoutView,
  allLayoutViews,
  compareViewRecency,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceView,
} from "@/features/workspace";
import { appIconStrokeWidth, NavigationTray, NavigationTrayItem, TooltipHint } from "@/shared/ui";

function isTransfers(tab: WorkspaceView) {
  const state = tab.state;
  if (state && typeof state === "object" && "path" in state && typeof state.path === "string")
    return state.path === transfersPath;
  return new URL(tab.route, "https://misty.local").searchParams.get("view") === "transfers";
}

const destinations = [
  { label: "Explorer", path: "/files", icon: FolderOpen, transfers: false },
  { label: "Transfers", path: "/files?view=transfers", icon: ArrowRightLeft, transfers: true },
];

/** Files uses the same disclosure tray as Spaces, with a destination for each file surface. */
export function NavigatorFiles({ activeTab }: { activeTab: WorkspaceView | undefined }) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const active = activeTab?.surfaceId === "files";
  return (
    <NavigationTray
      id="navigator-files"
      label="Files"
      groupLabel="Files destinations"
      icon={
        <Folders
          className="size-4 shrink-0 justify-self-center"
          size={16}
          strokeWidth={appIconStrokeWidth}
          aria-hidden="true"
        />
      }
      active={active}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      {destinations.map(({ label, path, icon: Icon, transfers }) => (
        <TooltipHint key={label} content={label}>
          <NavigationTrayItem>
            <Link
              to={path}
              aria-label={label}
              aria-current={active && isTransfers(activeTab) === transfers ? "page" : undefined}
              data-navigation-destination="true"
              data-misty-window-drag-block="true"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const request = workspaceSurfaceFromRoute(path)!;
                useWorkspaceStore.getState().setScope("global");
                const workspace = useWorkspaceStore.getState();
                const placeholder = activeLayoutView(workspace.layout)?.placeholder;
                const existing =
                  !placeholder &&
                  allLayoutViews(workspace.layout)
                    .filter(
                      (tab) =>
                        !tab.placeholder &&
                        tab.surfaceId === "files" &&
                        isTransfers(tab) === transfers,
                    )
                    .sort(compareViewRecency)[0];
                if (existing) {
                  workspace.focusView(existing.id);
                  navigate(existing.route, { replace: true });
                  return;
                }
                const tab = workspace.openSurface({
                  ...request,
                  title: transfers ? "Transfers" : "Files",
                  state: transfers ? { version: 1, path: transfersPath } : {},
                  forceNew: true,
                  paneId: placeholder ? workspace.layout.focusedPaneId : undefined,
                });
                navigate(tab.route, { replace: true });
              }}
            >
              <Icon
                className="size-4 shrink-0"
                size={16}
                strokeWidth={appIconStrokeWidth}
                aria-hidden="true"
              />
            </Link>
          </NavigationTrayItem>
        </TooltipHint>
      ))}
    </NavigationTray>
  );
}
