import { AppWindow, Eraser, History } from "lucide-react";
import {
  isBrowserInternalUrl,
  parseBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  menuShortcutClass,
} from "@/shared/ui";
import { ShortcutText } from "@/features/shortcuts";

const recentLimit = 8;

function ClosedTabIcon({ tab }: { tab: WorkspaceTab }) {
  if (tab.surfaceId !== "browser") return <AppWindow />;
  const url = parseBrowserTabState(tab.state).url;
  return isBrowserInternalUrl(url) ? <History /> : (
    <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
      <SavedWebsiteIcon url={url} />
    </span>
  );
}

/** History, like Chrome's: the full history page plus recently closed tabs. */
export function BrowserHistoryMenu(props: {
  openHistory: () => void;
  reopenClosedTab: (index: number) => void;
  clearBrowsingData: () => void;
}) {
  const closedTabs = useWorkspaceStore((state) => state.closedTabs);
  const recent = closedTabs.slice(0, recentLimit);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <History />
        History
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <DropdownMenuItem onSelect={props.openHistory}>
          <History />
          <span className="flex-1">History</span>
          <ShortcutText commandId="browser.history" className={menuShortcutClass} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.clearBrowsingData}>
          <Eraser />
          <span className="flex-1">Clear browsing data…</span>
          <ShortcutText commandId="browser.clear_data" className={menuShortcutClass} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Recently closed</DropdownMenuLabel>
        {recent.length ? (
          recent.map((closed, index) => (
            <DropdownMenuItem
              key={`${closed.tab.id}:${index}`}
              onSelect={() => props.reopenClosedTab(index)}
            >
              <ClosedTabIcon tab={closed.tab} />
              <span className="min-w-0 flex-1 truncate">{closed.tab.title || "Untitled"}</span>
              {index === 0 ? (
                <ShortcutText commandId="workspace.reopen_tab" className={menuShortcutClass} />
              ) : null}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No recently closed tabs</DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
