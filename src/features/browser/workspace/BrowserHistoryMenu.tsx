import { AppWindow, Eraser, History } from "lucide-react";
import {
  isBrowserInternalUrl,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { DropdownMenuLabel, DropdownMenuSeparator, MenuItem, MenuSubmenu } from "@/shared/ui";
import { ShortcutText } from "@/features/shortcuts";

const recentLimit = 8;

function ClosedViewIcon({ tab }: { tab: WorkspaceView }) {
  if (tab.surfaceId !== "browser") return <AppWindow />;
  const url = parseBrowserViewState(tab.state).url;
  return isBrowserInternalUrl(url) ? (
    <History />
  ) : (
    <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
      <SavedWebsiteIcon url={url} />
    </span>
  );
}

/** History, like Chrome's: the full history page plus recently closed tabs. */
export function BrowserHistoryMenu(props: {
  openHistory: () => void;
  reopenClosedView: (index: number) => void;
  clearBrowsingData: () => void;
}) {
  const closedTabs = useWorkspaceStore((state) => state.closedItems);
  const recent = closedTabs.slice(0, recentLimit);
  return (
    <MenuSubmenu icon={<History />} label="History" width="xl">
      <MenuItem
        icon={<History />}
        label="History"
        shortcut={<ShortcutText commandId="browser.history" />}
        onSelect={props.openHistory}
      />
      <MenuItem
        icon={<Eraser />}
        label="Clear browsing data…"
        shortcut={<ShortcutText commandId="browser.clear_data" />}
        onSelect={props.clearBrowsingData}
      />
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Recently closed</DropdownMenuLabel>
      {recent.length ? (
        recent.map((closed, index) => (
          <MenuItem
            key={`${closed.view.id}:${index}`}
            icon={<ClosedViewIcon tab={closed.view} />}
            label={closed.view.title || "Untitled"}
            shortcut={index === 0 ? <ShortcutText commandId="workspace.reopen_tab" /> : undefined}
            onSelect={() => props.reopenClosedView(index)}
          />
        ))
      ) : (
        <MenuItem label="No recently closed tabs" disabled />
      )}
    </MenuSubmenu>
  );
}
