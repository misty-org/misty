import { ExtensionsToolbar } from "@/features/extensions/ExtensionsToolbar";
import {
  BrowserDownloadsButton,
  BrowserLibraryMenus,
  BrowserMenuView,
  BrowserNavigationButtons,
  BrowserOmnibox,
  BrowserPaneLayoutMenu,
  BrowserToolbar,
  normalizeBrowserAddress,
  useBrowserChromeSlot,
} from "@/features/browser/workspace";
import { useHiddenToolbarButtons } from "@/features/settings/browserToolbarButtons";
import { browserInternalUrl, useWorkspaceStore, type WorkspaceView } from "@/features/workspace";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";

const keepOverlay = async () => {};

/**
 * The browser toolbar on a page that isn't a browser page. It is the same toolbar, built from
 * the same live parts: the pane layout menu, the real address field, extensions, downloads,
 * sync, the profile and the browser menu. There is just no page, so back, forward and reload
 * rest, the address field starts empty and opens what you type in a new browser tab, and the
 * menu's page rows are disabled. The pane hosts it, so a browser page and any other page
 * share one toolbar.
 */
export function PaneToolbarFallback({ tab }: { tab: WorkspaceView }) {
  const chrome = useBrowserChromeSlot();
  const hiddenButtons = useHiddenToolbarButtons();
  return (
    <BrowserToolbar
      data-misty-window-drag-block="true"
      nav={
        <BrowserNavigationButtons
          canGoBack={false}
          canGoForward={false}
          showStop={false}
          reloadDisabled
          onTravel={() => {}}
          onReload={() => {}}
        />
      }
      address={
        <BrowserOmnibox
          currentUrl=""
          onNavigate={(value) =>
            useWorkspaceStore.getState().openBrowserView({ url: normalizeBrowserAddress(value) })
          }
        />
      }
      tools={
        <>
          <BrowserPaneLayoutMenu tabId={tab.id} />
          {hiddenButtons.has("extensions") ? null : <ExtensionsToolbar tabId={tab.id} />}
          {hiddenButtons.has("downloads") ? null : (
            <BrowserDownloadsButton
              suspensionReason={`browser-downloads:${tab.id}`}
              onShowAll={() =>
                useWorkspaceStore
                  .getState()
                  .openBrowserView({ url: browserInternalUrl("downloads") })
              }
            />
          )}
          {chrome?.sync}
          <BrowserMenuView
            url=""
            library={<BrowserLibraryMenus />}
            account={chrome?.accountItems}
            setOverlay={keepOverlay}
            openExternal={openSystemExternalLink}
            reportError={() => {}}
          />
        </>
      }
    />
  );
}
