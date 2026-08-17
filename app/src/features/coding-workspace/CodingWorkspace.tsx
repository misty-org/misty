import { PanelLeft, PanelRight } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { cn } from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace";
import { CodeExplorer } from "./components/CodeExplorer";
import { CodeStatusBar } from "./components/CodeStatusBar";
import { CodeTerminal } from "./components/CodeTerminal";
import { EditorArea } from "./components/EditorArea";
import { OpenFolderCard } from "./components/OpenFolderCard";
import { useGitStore } from "./git/useGitStore";
import { QuickInput, type QuickInputMode } from "./quickinput/QuickInput";
import { useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";
import { useFileWatcher } from "./watcher/useFileWatcher";

const AiSettingsDialog = lazy(() =>
  import("./ai/AiSettingsDialog").then((module) => ({ default: module.AiSettingsDialog })),
);
const InlineRewrite = lazy(() =>
  import("./ai/InlineRewrite").then((module) => ({ default: module.InlineRewrite })),
);

interface InlineRequest {
  path: string;
  groupId: string;
  selection: string;
  from: number;
  to: number;
}

export function CodingWorkspace() {
  const rootPath = useCodingWorkspaceStore((state) => state.rootPath);
  const filesPaneOpen = useCodingWorkspaceStore((state) => state.filesPaneOpen);
  const terminalPaneOpen = useCodingWorkspaceStore((state) => state.terminalPaneOpen);
  const setFilesPaneOpen = useCodingWorkspaceStore((state) => state.setFilesPaneOpen);
  const setTerminalPaneOpen = useCodingWorkspaceStore((state) => state.setTerminalPaneOpen);

  const activeTab = useCodingWorkspaceStore(
    useShallow((state) => {
      const group =
        state.groups.find((entry) => entry.id === state.activeGroupId) ?? state.groups[0];
      const tab = group?.activeTabPath
        ? group.tabs.find((entry) => entry.path === group.activeTabPath)
        : null;
      return tab ? { path: tab.path, name: tab.name } : null;
    }),
  );

  const refreshGit = useGitStore((state) => state.refresh);
  const clearGit = useGitStore((state) => state.clear);

  const [quickInputMode, setQuickInputMode] = useState<QuickInputMode | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [inlineRequest, setInlineRequest] = useState<InlineRequest | null>(null);

  const filesRef = useRef<ImperativePanelHandle | null>(null);
  const terminalRef = useRef<ImperativePanelHandle | null>(null);

  useFileWatcher(rootPath);

  // Push a contextual title to the workspace tab that hosts this surface, so
  // the tab bar and the "Code" group dropdown show "Code · <folder>" instead
  // of a generic "Code" label. Runs whenever the workspace root changes.
  useEffect(() => {
    const folder = rootPath ? (rootPath.split("/").filter(Boolean).pop() ?? "Code") : null;
    const title = folder ? `Code · ${folder}` : "Code";
    const state = useWorkspaceStore.getState();
    const codeTab = state.layout.panes
      .flatMap((pane) => pane.tabs)
      .find((tab) => tab.surfaceId === "code");
    if (codeTab) state.renameTab(codeTab.id, title);
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      clearGit();
      return;
    }
    // Defer both the initial git refresh and the interval setup until after
    // the first paint so navigation into the Code tab feels instant. The
    // native `git` subprocess is cheap but the IPC round-trip still adds up.
    const startupHandle = window.setTimeout(() => void refreshGit(rootPath), 900);
    const interval = window.setInterval(() => void refreshGit(rootPath), 30_000);
    return () => {
      window.clearTimeout(startupHandle);
      window.clearInterval(interval);
    };
  }, [rootPath, refreshGit, clearGit]);

  useEffect(() => {
    const files = filesRef.current;
    if (!files) return;
    if (filesPaneOpen && files.isCollapsed()) files.expand();
    if (!filesPaneOpen && !files.isCollapsed()) files.collapse();
  }, [filesPaneOpen]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (terminalPaneOpen && terminal.isCollapsed()) terminal.expand();
    if (!terminalPaneOpen && !terminal.isCollapsed()) terminal.collapse();
  }, [terminalPaneOpen]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "b" && !shift) {
        event.preventDefault();
        useCodingWorkspaceStore.getState().toggleFilesPane();
      } else if (key === "j" && !shift) {
        event.preventDefault();
        useCodingWorkspaceStore.getState().toggleTerminalPane();
      } else if (key === "\\" && !shift) {
        event.preventDefault();
        useCodingWorkspaceStore.getState().splitActiveTab();
      } else if (key === "p" && !shift) {
        event.preventDefault();
        setQuickInputMode("files");
      } else if (key === "p" && shift) {
        event.preventDefault();
        setQuickInputMode("commands");
      } else if (key === "f" && shift) {
        event.preventDefault();
        setQuickInputMode("search");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    const handleInline = (event: Event) => {
      const detail = (event as CustomEvent<InlineRequest>).detail;
      if (!detail) return;
      setInlineRequest(detail);
    };
    window.addEventListener("misty:code-inline-ai", handleInline);
    return () => window.removeEventListener("misty:code-inline-ai", handleInline);
  }, []);

  const toggleFiles = useCallback(
    () => setFilesPaneOpen(!filesPaneOpen),
    [filesPaneOpen, setFilesPaneOpen],
  );
  const toggleTerminal = useCallback(
    () => setTerminalPaneOpen(!terminalPaneOpen),
    [terminalPaneOpen, setTerminalPaneOpen],
  );

  const applyInlineRewrite = useCallback(
    (text: string) => {
      if (!inlineRequest) return;
      const { path, groupId, from, to } = inlineRequest;
      window.dispatchEvent(
        new CustomEvent("misty:code-inline-apply", {
          detail: { path, groupId, from, to, text },
        }),
      );
      // Fall back: directly update store contents if no listener splices the range
      const store = useCodingWorkspaceStore.getState();
      const tab = store.groups
        .find((group) => group.id === groupId)
        ?.tabs.find((entry) => entry.path === path);
      if (!tab) return;
      const nextContents = tab.contents.slice(0, from) + text + tab.contents.slice(to);
      store.updateTabContents(groupId, path, nextContents);
    },
    [inlineRequest],
  );

  if (!rootPath) return <OpenFolderCard />;

  const language = activeTab ? languageOf(activeTab.name) : "";

  return (
    <section className="relative grid h-full min-h-0 grid-rows-[32px_minmax(0,1fr)_24px] bg-charcoal-workspace">
      <header className="flex h-8 items-center gap-2 border-b border-charcoal-border bg-charcoal-sidebar px-2.5">
        <span className="min-w-0 flex-1 truncate pl-1 font-mono text-[11px] text-cream-muted">
          {activeTab ? (
            <>
              <span className="text-cream-muted/70">
                {formatBreadcrumb(rootPath, activeTab.path)}
              </span>
              <span className="text-cream-bright">{activeTab.name}</span>
            </>
          ) : (
            <span className="text-cream-muted/70">{rootPath}</span>
          )}
        </span>
        <TitleBarToggle
          label="Toggle files (⌘B)"
          active={filesPaneOpen}
          icon={<PanelLeft size={12} />}
          onClick={toggleFiles}
        >
          Files
        </TitleBarToggle>
        <TitleBarToggle
          label="Toggle terminal (⌘J)"
          active={terminalPaneOpen}
          icon={<PanelRight size={12} />}
          onClick={toggleTerminal}
        >
          Terminal
        </TitleBarToggle>
      </header>

      <PanelGroup direction="horizontal" className="min-h-0">
        <Panel
          ref={filesRef}
          defaultSize={20}
          minSize={12}
          collapsible
          collapsedSize={0}
          onCollapse={() => setFilesPaneOpen(false)}
          onExpand={() => setFilesPaneOpen(true)}
        >
          <CodeExplorer />
        </Panel>
        <PanelResizeHandle className="w-px bg-charcoal-border transition-colors hover:bg-charcoal-active" />
        <Panel minSize={30}>
          <EditorArea rootPath={rootPath} />
        </Panel>
        <PanelResizeHandle className="w-px bg-charcoal-border transition-colors hover:bg-charcoal-active" />
        <Panel
          ref={terminalRef}
          defaultSize={32}
          minSize={14}
          collapsible
          collapsedSize={0}
          onCollapse={() => setTerminalPaneOpen(false)}
          onExpand={() => setTerminalPaneOpen(true)}
        >
          <CodeTerminal paneOpen={terminalPaneOpen} />
        </Panel>
      </PanelGroup>

      <CodeStatusBar onOpenAiSettings={() => setAiSettingsOpen(true)} />

      <QuickInput
        mode={quickInputMode}
        onClose={() => setQuickInputMode(null)}
        onOpenSettings={() => setAiSettingsOpen(true)}
      />
      {aiSettingsOpen ? (
        <Suspense fallback={null}>
          <AiSettingsDialog open onClose={() => setAiSettingsOpen(false)} />
        </Suspense>
      ) : null}
      {inlineRequest ? (
        <Suspense fallback={null}>
          <InlineRewrite
            open
            selection={inlineRequest.selection}
            language={language}
            filename={activeTab?.name ?? ""}
            onClose={() => setInlineRequest(null)}
            onApply={applyInlineRewrite}
            onOpenSettings={() => {
              setAiSettingsOpen(true);
              setInlineRequest(null);
            }}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

interface TitleBarToggleProps {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}

function TitleBarToggle({ label, active, icon, onClick, children }: TitleBarToggleProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-charcoal-border px-2 py-0.5 font-mono text-[10.5px]",
        active ? "bg-charcoal-hover text-cream-bright" : "text-cream-muted hover:text-cream",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function formatBreadcrumb(rootPath: string, filePath: string): string {
  if (!filePath.startsWith(rootPath)) return "";
  const relative = filePath.slice(rootPath.length).replace(/^\//, "");
  const parts = relative.split("/");
  if (parts.length <= 1) return "";
  return `${parts.slice(0, -1).join(" / ")} / `;
}

function languageOf(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension ?? "";
}
