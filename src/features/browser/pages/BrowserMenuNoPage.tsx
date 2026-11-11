import { useState } from "react";
import {
  browserInternalUrl,
  useWorkspaceStore,
  type BrowserInternalPage,
} from "@/features/app-windows";
import { invokeShortcutCommand } from "@/features/shortcuts";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { ClearBrowsingDataDialog } from "./BrowserClearDataDialog";
import { BrowserHelpDialog } from "./BrowserHelpDialog";
import { BrowserMenuLeadRows } from "./BrowserMenuLeadRows";
import { BrowserMenuView } from "./BrowserMenuView";
import { BrowserPaneLayoutSubmenu } from "./BrowserPaneLayoutMenu";
import type { BrowserPageCommands } from "./useBrowserPageCommands";

/**
 * The browser's More menu on a page that isn't a web page. It is the same menu, with the same rows
 * in the same places, so it never changes shape: the rows that act on a web page are there and off,
 * and the window-level rows work as they do anywhere.
 */
export function BrowserMenuNoPage() {
  const tabId = useWorkspaceStore((state) => state.layout.activeTabId) ?? "";
  const [helpRequest, setHelpRequest] = useState(0);
  const [clearOpen, setClearOpen] = useState(false);
  const openInNewTab = (url: string) => useWorkspaceStore.getState().openBrowserView({ url });
  const commands: BrowserPageCommands = {
    newTab: () => void invokeShortcutCommand("search.toggle"),
    newWindow: () => void invokeShortcutCommand("workspace.new_window"),
    newIncognitoWindow: () => void invokeShortcutCommand("workspace.new_incognito_window"),
    reopenView: () => void invokeShortcutCommand("workspace.reopen_tab"),
    reopenClosedTab: (index) => {
      if (useWorkspaceStore.getState().reopenClosedView(index))
        window.dispatchEvent(new Event("misty:workspace-projection-applied"));
    },
    help: () => setHelpRequest((value) => value + 1),
    openPage: (page: BrowserInternalPage) => openInNewTab(browserInternalUrl(page)),
    openInNewTab,
    clearBrowsingData: () => setClearOpen(true),
  };
  return (
    <>
      <BrowserMenuView
        toolsIcon
        url=""
        commands={commands}
        setOverlay={async () => {}}
        openExternal={openSystemExternalLink}
        reportError={() => {}}
        layout={<BrowserPaneLayoutSubmenu tabId={tabId} />}
        lead={
          <BrowserMenuLeadRows
            tabId={tabId}
            runtimeId=""
            url=""
            agentOwned={false}
            anchor={() => null}
          />
        }
      />
      <BrowserHelpDialog request={helpRequest} suspensionReason="menu-help" />
      <ClearBrowsingDataDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        onCleared={() => setClearOpen(false)}
      />
    </>
  );
}
