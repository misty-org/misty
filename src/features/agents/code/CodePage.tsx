import {
  Database,
  FolderTree,
  GitCompareArrows,
  History,
  RadioTower,
  RotateCw,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceViewFocused, useWorkspaceViewId } from "@/features/app-windows";
import { useShortcutHandler } from "@/features/shortcuts";
import {
  EmptyState,
  ErrorState,
  IconButton,
  SplitHandle,
  lazyTool,
  ToolSuspense,
  SplitPane as Panel,
  SplitPanes as PanelGroup,
  Surface,
} from "@misty/ui";
import { useChatFolder, useChatFolders } from "../shared-folders/chatFolder";
import { ChatFolderPicker, ProjectPicker } from "../context-panel/ChatFolderPicker";
import { ContextPanelSkeleton } from "../context-panel/PanelSkeletons";
import { useGitStore } from "../context-panel/git/store";
import { FileSearchOverlay } from "../context-panel/files/FileSearchOverlay";
import { FileTree } from "../context-panel/files/FileTree";
import { CloseFileDialog, FileTabs } from "../context-panel/files/FilesPanel";
import { useFilesStore } from "../context-panel/files/filesStore";
import { useTreePreferences } from "../context-panel/files/treePreferences";
import type { EditorPaneActions } from "../context-panel/editor/EditorPane";
import "../context-panel/codeViews.css";
import { openCodeFileSearch } from "./codeFileScope";
import { ProjectSearch, useProjectSearch } from "./ProjectSearch";
import { useShareCodeBar } from "./CodeBarStatus";
import {
  updateCodePageLayout,
  useCodePageLayout,
  useCodePageShown,
  type CodeActivity,
} from "./codePageStore";
import { DatabaseMain, DatabaseSidebar } from "./db";
import { GitReviewBar } from "./git/GitReviewBar";
import { SourceControl } from "./git/SourceControl";
import { LiveMain, LiveSidebar, useLiveMainShown, useLiveWorkFolder } from "./live";
import { CodeChatColumn } from "./sessions/CodeChatColumn";
import { SessionsSidebar } from "./sessions/SessionsSidebar";
import { closeChat, openProject, useCodeChat, useCodeProject } from "./useCodeSession";

const EditorPane = lazyTool(() => import("../context-panel/editor/EditorPane"));
const TerminalPanel = lazyTool(() => import("../context-panel/terminal/TerminalPanel"));

/** The sidebar's views, each with the icon its subject wears elsewhere in Misty. */
const activityList: { id: CodeActivity; label: string; icon: LucideIcon }[] = [
  { id: "sessions", label: "Sessions", icon: History },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "search", label: "Search", icon: Search },
  { id: "changes", label: "Changes", icon: GitCompareArrows },
  { id: "live", label: "Live sessions", icon: RadioTower },
  { id: "databases", label: "Databases", icon: Database },
];

/** The panels clip rather than hide what overflows: a hidden box can still be scrolled, and both
 * CodeMirror (keeping its cursor in view) and xterm (focusing its input at the cursor) scroll
 * every scrollable box around them, which slid the page as you typed. A clipping box isn't a
 * scroller, though, so as a flex item it would refuse to shrink past its content: one long line
 * of code widened its panel and pushed the sidebar, the tabs and the dividers aside. The zero
 * minimums keep each panel at the size it was given. */
const clipped = { overflow: "clip", minWidth: 0, minHeight: 0 } as const;

/** The rail's shortcut hints, for the views that have one. */
const shortcuts: Partial<Record<CodeActivity, string>> = { files: "⌘B", search: "⌘⇧F" };

/** Counts this page among those shown, so files opened elsewhere come here (`codePageStore`). */
function useShownMark() {
  useEffect(() => {
    useCodePageShown.setState((state) => ({ count: state.count + 1 }));
    return () => useCodePageShown.setState((state) => ({ count: Math.max(0, state.count - 1) }));
  }, []);
}

/**
 * The Code page: a quiet editor for a project folder, after VS Code's workbench with less of it
 * and Zed's quiet bars. A narrow column picks what the sidebar shows (sessions, files, search,
 * Git changes, live sessions, databases); the editor's tabs fill the rest, with a terminal under
 * them on request. There is no top bar, and no foot of its own: the page's status (vim's mode,
 * branch, cursor, language server) shows in the window's bottom bar. A chat picked from the
 * sessions opens in a column left of the editor, and the page then works in that chat's folder.
 * While a live session is joined, the page shows that session's worktree.
 */
export function CodePage() {
  useShownMark();
  const { folder, loaded, failed, retry } = useCodeProject();
  const { chat, pending } = useCodeChat();
  // An open chat's folder, its project or its scratch folder, is the page's.
  const chatFolder = useChatFolder(chat || null);

  if (chat) {
    if (chatFolder.failed)
      return (
        <ErrorState
          title="Couldn't read this chat's folder"
          line="Something went wrong on this computer. Try again in a moment."
          action={{ label: "Try again", icon: RotateCw, onClick: chatFolder.retry }}
        />
      );
    if (!chatFolder.loaded || !chatFolder.folder) return <ContextPanelSkeleton tab="files" />;
    return <CodeWorkbench spaceFolder={chatFolder.folder} chat={chat} />;
  }
  if (pending) return <ContextPanelSkeleton tab="files" />;
  if (failed) {
    return (
      <ErrorState
        title="Couldn't read your project folders"
        line="Something went wrong on this computer. Try again in a moment."
        action={{ label: "Try again", icon: RotateCw, onClick: retry }}
      />
    );
  }
  if (!loaded) return <ContextPanelSkeleton tab="files" />;
  if (!folder) return <CodeStart />;
  return <CodeWorkbench spaceFolder={folder} chat="" />;
}

/**
 * The page before any project is picked and with no chat open: the sessions, to open a chat in,
 * beside the ask to choose a folder.
 */
function CodeStart() {
  const sidebarSize = useCodePageLayout((state) => state.value.sidebarSize);
  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-clip" data-code-page="">
      <PanelGroup
        direction="horizontal"
        className="min-h-0 min-w-0 flex-1"
        onLayout={(sizes) => {
          if (sizes.length === 2 && Math.round(sizes[0]) !== Math.round(sidebarSize))
            updateCodePageLayout({ sidebarSize: sizes[0] });
        }}
      >
        <Panel
          id="code-sidebar"
          style={clipped}
          order={1}
          defaultSize={sidebarSize}
          minSize={12}
          maxSize={50}
        >
          <Surface
            as="aside"
            tone="sidebar"
            className="flex h-full min-h-0 min-w-0 flex-col"
            aria-label="Sessions"
          >
            <SessionsSidebar />
          </Surface>
        </Panel>
        <SplitHandle direction="horizontal" label="Resize sidebar" seam />
        <Panel id="code-main" order={2} minSize={30} style={clipped}>
          <EmptyState
            title="Choose a project folder"
            line="The Code page edits a folder on this computer."
            action={{
              label: "Choose folder",
              onClick: () =>
                void useChatFolders
                  .getState()
                  .addProject()
                  .then((path) => path && openProject(path))
                  .catch(() => undefined),
            }}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}

/** The workbench for `spaceFolder`: the open chat's folder while `chat` names one. */
function CodeWorkbench({ spaceFolder, chat }: { spaceFolder: string; chat: string }) {
  const live = useLiveWorkFolder(spaceFolder);
  // A joined live session's worktree stands in for the project folder.
  const root = live?.folder ?? spaceFolder;
  const layout = useCodePageLayout((state) => state.value);
  const focused = useWorkspaceViewFocused();
  // The window's bottom bar shows this page's branch, file and language server while it's focused.
  useShareCodeBar(useWorkspaceViewId(), root, live?.name ?? null);
  // Git's view of the folder, for the Changes count and the bar's branch.
  useEffect(() => {
    void useGitStore.getState().refresh(root);
  }, [root]);
  const storeRoot = useFilesStore((state) => state.root);
  const setRoot = useFilesStore((state) => state.setRoot);
  const searchRoot = useFilesStore((state) => state.searchRoot);
  const openFiles = useFilesStore((state) => state.openFiles);
  const active = useFilesStore((state) => state.activeFilePath);
  const liveMainShown = useLiveMainShown();
  // How many files Git sees changed, for the Changes icon's count.
  const changeCount = useGitStore((state) => {
    const status = state.statusByWorkspace[root];
    if (!status) return 0;
    const files = [...status.staged, ...status.unstaged, ...status.untracked];
    return new Set(files.map((file) => file.path)).size;
  });
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => setRoot(root), [root, setRoot]);
  useEffect(() => {
    void useTreePreferences.getState().hydrate();
  }, []);
  // The page has no tree tab: with files open, one of them is always the shown one.
  useEffect(() => {
    if (active === null && openFiles.length > 0)
      useFilesStore.getState().activateFile(openFiles[openFiles.length - 1]);
  }, [active, openFiles]);

  const close = useCallback((path: string) => {
    if (useFilesStore.getState().dirtyPaths[path]) setClosing(path);
    else useFilesStore.getState().closeFile(path);
  }, []);
  // ⌘⇧F opens the search view, as VS Code's does, with its field ready to type in.
  const searchText = useCallback(() => {
    useFilesStore.getState().closeSearch();
    updateCodePageLayout({ activity: "search", sidebarOpen: true });
    useProjectSearch.getState().focus();
  }, []);
  // ⌘P opens the ⌘K box scoped to this folder's files, the one place every search starts.
  const quickOpen = useCallback(() => openCodeFileSearch(root), [root]);
  const actions = useMemo<EditorPaneActions>(() => ({ close, quickOpen }), [close, quickOpen]);

  const shown = () => focused;
  useShortcutHandler("code.quick_open", quickOpen, shown);
  useShortcutHandler("code.search_text", searchText, shown);
  useShortcutHandler(
    "code.toggle_terminal",
    () => updateCodePageLayout({ terminalOpen: !useCodePageLayout.getState().value.terminalOpen }),
    shown,
  );
  useShortcutHandler(
    "code.toggle_sidebar",
    () => updateCodePageLayout({ sidebarOpen: !useCodePageLayout.getState().value.sidebarOpen }),
    shown,
  );

  // The store still names the folder shown before, for the one frame until it follows this one.
  if (storeRoot !== root) return <ContextPanelSkeleton tab="files" />;

  const pick = (activity: CodeActivity) =>
    updateCodePageLayout(
      layout.activity === activity && layout.sidebarOpen
        ? { sidebarOpen: false }
        : { activity, sidebarOpen: true },
    );

  const editorArea = (
    // Clipped, not hidden: CodeMirror scrolls every scrollable ancestor to keep the cursor in
    // view, and a hidden overflow can still be scrolled, which slid the whole page as you typed.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip">
      <FileTabs onClose={close} withTree={false} blocks />
      {active ? <GitReviewBar path={active} /> : null}
      <div className="relative flex min-h-0 flex-1">
        {openFiles.length === 0 ? (
          <EmptyState
            title="No file open"
            line="Open one from the files list, or find it by name."
            action={{ label: "Quick open", icon: Search, onClick: quickOpen }}
          />
        ) : (
          // Open tabs stay mounted, so each keeps its draft, cursor, undo and scroll.
          openFiles.map((path) => (
            <div
              key={path}
              className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-clip"
              hidden={active !== path}
            >
              <ToolSuspense tool="code editor">
                <EditorPane path={path} appearance="page" actions={actions} />
              </ToolSuspense>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const main =
    layout.activity === "databases" ? (
      <DatabaseMain />
    ) : layout.activity === "live" && liveMainShown ? (
      <LiveMain />
    ) : (
      editorArea
    );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-clip" data-code-page="">
      {/* No top bar: the rail picks the sidebar's view (the open one's icon hides the sidebar,
          as ⌘B does), the sidebar names the folder, and the terminal's switch sits in the foot. */}
      <div className="flex min-h-0 flex-1 overflow-clip">
        <Surface
          as="nav"
          tone="sidebar"
          className="flex w-12 flex-none flex-col items-center gap-1 border-r pt-2"
          aria-label="Sidebar views"
        >
          {activityList.map(({ id, label, icon: Icon }) => (
            <IconButton
              key={id}
              label={label}
              shortcut={shortcuts[id]}
              count={id === "changes" ? changeCount : undefined}
              tooltipSide="right"
              aria-pressed={layout.sidebarOpen && layout.activity === id}
              onClick={() => {
                // A folder search over the files list gives way to whichever view is picked.
                useFilesStore.getState().closeSearch();
                pick(id);
                if (id === "search") useProjectSearch.getState().focus();
              }}
            >
              <Icon />
            </IconButton>
          ))}
        </Surface>
        <PanelGroup
          direction="horizontal"
          className="min-h-0 min-w-0 flex-1"
          onLayout={(sizes) => {
            if (
              layout.sidebarOpen &&
              sizes.length === 2 &&
              Math.round(sizes[0]) !== Math.round(layout.sidebarSize)
            )
              updateCodePageLayout({ sidebarSize: sizes[0] });
          }}
        >
          {layout.sidebarOpen ? (
            <>
              <Panel
                id="code-sidebar"
                style={clipped}
                order={1}
                defaultSize={layout.sidebarSize}
                minSize={12}
                maxSize={50}
              >
                <Surface
                  as="aside"
                  tone="sidebar"
                  className="relative flex h-full min-h-0 min-w-0 flex-col"
                  aria-label="Sidebar"
                >
                  {layout.activity === "sessions" ? (
                    <SessionsSidebar />
                  ) : layout.activity === "files" ? (
                    <>
                      <FileTree
                        toolbar={{
                          // With a chat open, the folder is the chat's to change.
                          heading: live ? undefined : chat ? (
                            <ChatFolderPicker conversationId={chat} heading />
                          ) : (
                            <ProjectPicker value={spaceFolder} onPick={openProject} heading />
                          ),
                          onOpenTerminal: () => updateCodePageLayout({ terminalOpen: true }),
                        }}
                      />
                      {searchRoot ? <FileSearchOverlay searchRoot={searchRoot} /> : null}
                    </>
                  ) : layout.activity === "search" ? (
                    <ProjectSearch root={root} />
                  ) : layout.activity === "changes" ? (
                    <SourceControl folder={root} />
                  ) : layout.activity === "live" ? (
                    <LiveSidebar folder={spaceFolder} />
                  ) : (
                    <DatabaseSidebar />
                  )}
                </Surface>
              </Panel>
              <SplitHandle direction="horizontal" label="Resize sidebar" seam />
            </>
          ) : null}
          <Panel id="code-main" order={2} minSize={30} style={clipped}>
            {/* The open chat sits left of the editor, its width kept for the device. */}
            <PanelGroup
              direction="horizontal"
              className="min-h-0 min-w-0"
              onLayout={(sizes) => {
                if (
                  chat &&
                  sizes.length === 2 &&
                  Math.round(sizes[0]) !== Math.round(layout.chatSize)
                )
                  updateCodePageLayout({ chatSize: sizes[0] });
              }}
            >
              {chat ? (
                <>
                  <Panel
                    id="code-chat"
                    style={clipped}
                    order={1}
                    defaultSize={layout.chatSize}
                    minSize={20}
                    maxSize={70}
                  >
                    <div className="flex h-full min-h-0 min-w-0 overflow-clip">
                      <CodeChatColumn conversationId={chat} onClose={closeChat} />
                    </div>
                  </Panel>
                  <SplitHandle direction="horizontal" label="Resize chat" seam />
                </>
              ) : null}
              <Panel id="code-work" order={2} minSize={30} style={clipped}>
                <PanelGroup
                  direction="vertical"
                  className="min-h-0 min-w-0"
                  onLayout={(sizes) => {
                    if (
                      layout.terminalOpen &&
                      sizes.length === 2 &&
                      Math.round(sizes[1]) !== Math.round(layout.terminalSize)
                    )
                      updateCodePageLayout({ terminalSize: sizes[1] });
                  }}
                >
                  <Panel id="code-editor" order={1} minSize={20} style={clipped}>
                    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-clip">{main}</div>
                  </Panel>
                  {layout.terminalOpen ? (
                    <>
                      <SplitHandle direction="vertical" label="Resize terminal" seam />
                      <Panel
                        id="code-terminal"
                        style={clipped}
                        order={2}
                        defaultSize={layout.terminalSize}
                        minSize={10}
                        maxSize={80}
                      >
                        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-clip">
                          <ToolSuspense tool="terminal">
                            <TerminalPanel chat={`code:${root}`} folder={root} />
                          </ToolSuspense>
                        </div>
                      </Panel>
                    </>
                  ) : null}
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
      <CloseFileDialog path={closing} onDone={() => setClosing(null)} />
    </div>
  );
}
