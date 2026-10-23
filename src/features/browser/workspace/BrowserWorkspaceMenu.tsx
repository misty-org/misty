import type { ReactNode, RefObject } from "react";
import type { WorkspaceView } from "@/features/workspace";
import { browserRuntimeId } from "@/features/webviews/browserRuntime";
import { BrowserLibraryMenus } from "./BrowserLibraryMenus";
import { BrowserMenu } from "./BrowserMenu";
import { BrowserMenuLeadRows } from "./BrowserMenuLeadRows";
import { BrowserPaneLayoutSubmenu } from "./BrowserPaneLayoutMenu";
import type { useBrowserPageCommands } from "./useBrowserPageCommands";

/** A browser page's ⋯ menu. The sidebar's version leads with the page's own rows (bookmark,
 * extensions); the toolbar's carries the library and pane layout instead. */
export function BrowserWorkspaceMenu({
  sidebarMenu,
  tab,
  url,
  agentOwned,
  nativeRuntime,
  commands,
  account,
  anchor,
  tools,
}: {
  sidebarMenu: boolean;
  tab: WorkspaceView;
  url: string;
  agentOwned: boolean;
  nativeRuntime: boolean;
  commands: ReturnType<typeof useBrowserPageCommands>["commands"];
  account?: ReactNode;
  anchor: RefObject<HTMLDivElement | null>;
  tools: ReactNode;
}) {
  return (
    <BrowserMenu
      toolsIcon={sidebarMenu}
      library={sidebarMenu ? undefined : <BrowserLibraryMenus />}
      layout={sidebarMenu ? undefined : <BrowserPaneLayoutSubmenu tabId={tab.id} />}
      account={account}
      lead={
        sidebarMenu ? (
          <BrowserMenuLeadRows
            tabId={tab.id}
            runtimeId={browserRuntimeId(tab)}
            url={url}
            agentOwned={agentOwned}
            onBookmark={commands.bookmark}
            anchor={() => anchor.current}
          />
        ) : undefined
      }
      nativeRuntime={nativeRuntime}
      tab={tab}
      url={url}
      commands={commands}
      tools={tools}
    />
  );
}
