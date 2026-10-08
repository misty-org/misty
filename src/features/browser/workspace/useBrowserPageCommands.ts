import { useShortcutHandler, invokeShortcutCommand } from "@/features/shortcuts";
import {
  blankBrowserUrl,
  browserInternalPage,
  browserInternalUrl,
  dockLeaves,
  isBrowserInternalUrl,
  type BrowserInternalPage,
  type BrowserViewState,
  type WorkspaceView,
  useWorkspaceStore,
} from "@/features/workspace";
import { save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { browserPageTools } from "../library/native";
import { pictureInPictureSupported } from "@/features/webviews/pictureInPictureSettings";
import { browserRuntimeCreated, browserRuntimeId, useBrowserRuntimeStore } from "./browserRuntime";

export interface BrowserPageCommands {
  newTab: () => void;
  newWindow: () => void;
  newPrivateView: () => void;
  reopenView: () => void;
  /** Reopens one tab from the recently closed list. */
  reopenClosedTab: (index: number) => void;
  help: () => void;
  openPage: (page: BrowserInternalPage) => void;
  openInNewTab: (url: string) => void;
  /** Present only while a native web page is showing. */
  find?: () => void;
  print?: () => void;
  savePage?: () => void;
  developerTools?: () => void;
  pictureInPicture?: () => void;
  /** Reader mode, set by the workspace that shows the reader. */
  readerMode?: () => void;
  /** Translate the page with Misty, set by the workspace. */
  translate?: () => void;
  stop?: () => void;
  copyLink?: () => void;
  qrCode?: () => void;
  bookmark?: () => void;
  clearBrowsingData: () => void;
}

function report(tabId: string, error: unknown) {
  useBrowserRuntimeStore
    .getState()
    .setError(tabId, error instanceof Error ? error.message : String(error));
}

function notice(tabId: string, message: string) {
  useBrowserRuntimeStore.getState().setNotice(tabId, message);
}

function safeFileName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]+/g, " ")
      .trim()
      .slice(0, 120) || "Page"
  );
}

/**
 * Everything the More menu and browser shortcuts can do for one tab. Tools
 * that act on the web page are left undefined while an internal page (or no
 * native page) is showing, so their menu items disable themselves.
 */
export function useBrowserPageCommands(input: {
  tab: WorkspaceView;
  state: BrowserViewState;
  nativeRuntime: boolean;
  focused: () => boolean;
  navigate: (url: string) => void;
}) {
  const { tab, state, nativeRuntime, focused, navigate } = input;
  const [findRequest, setFindRequest] = useState(0);
  const [bookmarkRequest, setBookmarkRequest] = useState(0);
  const [clearDataRequest, setClearDataRequest] = useState(0);
  const [helpRequest, setHelpRequest] = useState(0);
  const [qrCodeRequest, setQrCodeRequest] = useState(0);
  const internal = browserInternalPage(state.url);
  const pageLive =
    nativeRuntime && !internal && state.url !== blankBrowserUrl && browserRuntimeCreated(tab);
  const webPage = /^https?:\/\//i.test(state.url);
  const id = browserRuntimeId(tab);

  const openInNewTab = (url: string) => {
    const workspace = useWorkspaceStore.getState();
    const pane = dockLeaves(workspace.layout.root).find((candidate) =>
      candidate.views.some((item) => item.id === tab.id),
    );
    workspace.openBrowserView({ url, paneId: pane?.id });
  };

  const openPage = (page: BrowserInternalPage) => {
    const url = browserInternalUrl(page);
    // Reuse an empty tab or another Misty page rather than piling up tabs.
    if (state.url === blankBrowserUrl || isBrowserInternalUrl(state.url)) navigate(url);
    else openInNewTab(url);
  };

  const commands: BrowserPageCommands = {
    newTab: () => void invokeShortcutCommand("search.toggle"),
    newWindow: () => void invokeShortcutCommand("workspace.new_virtual_window"),
    newPrivateView: () => {
      const workspace = useWorkspaceStore.getState();
      const pane = dockLeaves(workspace.layout.root).find((candidate) =>
        candidate.views.some((item) => item.id === tab.id),
      );
      workspace.openBrowserView({ paneId: pane?.id, private: true });
    },
    reopenView: () => void invokeShortcutCommand("workspace.reopen_tab"),
    reopenClosedTab: (index) => {
      // The reopened tab is focused; the canvas then follows it to its route.
      if (useWorkspaceStore.getState().reopenClosedView(index))
        window.dispatchEvent(new Event("misty:workspace-projection-applied"));
    },
    help: () => setHelpRequest((value) => value + 1),
    openPage,
    openInNewTab,
    clearBrowsingData: () => setClearDataRequest((value) => value + 1),
    bookmark: webPage ? () => setBookmarkRequest((value) => value + 1) : undefined,
    qrCode: webPage ? () => setQrCodeRequest((value) => value + 1) : undefined,
    copyLink: webPage
      ? () =>
          void navigator.clipboard
            .writeText(state.url)
            .then(() => notice(tab.id, "Link copied."))
            .catch((error: unknown) => report(tab.id, error))
      : undefined,
  };
  if (pageLive) {
    commands.find = () => setFindRequest((value) => value + 1);
    commands.print = () => void browserPageTools.print(id).catch((error) => report(tab.id, error));
    if (pictureInPictureSupported())
      commands.pictureInPicture = () =>
        void browserPageTools
          .pictureInPicture(id, "toggle")
          .catch((error: unknown) => report(tab.id, error));
    commands.stop = () => {
      useBrowserRuntimeStore.getState().setLoading(tab.id, false);
      void browserPageTools.stop(id).catch((error) => report(tab.id, error));
    };
    commands.savePage = () =>
      void (async () => {
        const mac = /Mac/i.test(navigator.platform);
        const path = await save({
          title: "Save page as",
          defaultPath: `${safeFileName(tab.title)}.${mac ? "webarchive" : "html"}`,
          filters: mac
            ? [
                { name: "Web Archive", extensions: ["webarchive"] },
                { name: "HTML", extensions: ["html"] },
              ]
            : [{ name: "HTML", extensions: ["html"] }],
        });
        if (!path) return;
        await browserPageTools.savePage(id, path);
        notice(tab.id, "Page saved.");
      })().catch((error: unknown) => report(tab.id, error));
    commands.developerTools = () =>
      void browserPageTools
        .developerTools(id)
        .then(({ opened }) => {
          if (!opened)
            notice(tab.id, "Open Safari › Develop › this Mac › Misty to inspect this page.");
        })
        .catch((error: unknown) => report(tab.id, error));
  }

  const run = (command?: () => void) => () => {
    if (!command) return false;
    command();
    return true;
  };
  useShortcutHandler("browser.new_private_tab", run(commands.newPrivateView), focused, 100);
  useShortcutHandler("browser.find", run(commands.find), focused, 100);
  useShortcutHandler("browser.print", run(commands.print), focused, 100);
  useShortcutHandler("browser.picture_in_picture", run(commands.pictureInPicture), focused, 100);
  useShortcutHandler(
    "browser.history",
    run(() => openPage("history")),
    focused,
    100,
  );
  useShortcutHandler(
    "browser.downloads",
    run(() => openPage("downloads")),
    focused,
    100,
  );
  useShortcutHandler("browser.bookmark", run(commands.bookmark), focused, 100);
  useShortcutHandler("browser.developer_tools", run(commands.developerTools), focused, 100);
  useShortcutHandler("browser.clear_data", run(commands.clearBrowsingData), focused, 100);

  return {
    commands,
    internal,
    findRequest,
    bookmarkRequest,
    clearDataRequest,
    helpRequest,
    qrCodeRequest,
  };
}
