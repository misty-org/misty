import { Plus, RotateCcw, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { cn } from "@/shared/ui";
import { terminalContextEnv } from "../context/terminalContext";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

const XtermPane = lazy(() =>
  import("./XtermPane").then((module) => ({ default: module.XtermPane })),
);

interface CodeTerminalProps {
  paneOpen: boolean;
}

export function CodeTerminal({ paneOpen }: CodeTerminalProps) {
  const rootPath = useCodingWorkspaceStore((state) => state.rootPath);
  const terminalTabs = useCodingWorkspaceStore((state) => state.terminalTabs);
  const activeTerminalId = useCodingWorkspaceStore((state) => state.activeTerminalId);
  const addTerminalTab = useCodingWorkspaceStore((state) => state.addTerminalTab);
  const closeTerminalTab = useCodingWorkspaceStore((state) => state.closeTerminalTab);
  const setActiveTerminal = useCodingWorkspaceStore((state) => state.setActiveTerminal);
  const renameTerminalTab = useCodingWorkspaceStore((state) => state.renameTerminalTab);

  // Track whether the pane has been opened at least once. Once mounted, keep
  // the xterm instances alive across collapse/expand so the shell survives —
  // but don't spawn them until the user actually opens the terminal, so
  // navigating to Code with a collapsed terminal costs zero PTYs.
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  useEffect(() => {
    if (!paneOpen || hasBeenOpened) return;
    // Restoring an open terminal should never compete with the Code shell's
    // first paint. The native PTY and xterm chunk start after navigation has
    // settled, while an explicit reopen still happens promptly.
    const startupHandle = window.setTimeout(() => setHasBeenOpened(true), 1_100);
    return () => window.clearTimeout(startupHandle);
  }, [paneOpen, hasBeenOpened]);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalId) ?? null;
  const env = terminalContextEnv();

  const restartActive = useCallback(() => {
    if (!activeTab) return;
    useCodingWorkspaceStore.setState((state) => ({
      terminalTabs: state.terminalTabs.map((tab) =>
        tab.id === activeTab.id ? { ...tab, sessionKey: tab.sessionKey + 1 } : tab,
      ),
    }));
  }, [activeTab]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-sidebar">
      <header className="flex h-8 items-stretch border-b border-charcoal-border bg-charcoal-card">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {terminalTabs.map((tab) => {
            const isActive = tab.id === activeTerminalId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex items-center gap-2 border-r border-charcoal-border pl-3 pr-2 font-mono text-[11px]",
                  isActive ? "bg-charcoal-sidebar text-cream-bright" : "text-cream-muted",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isActive
                      ? "bg-[#e8d9c0] shadow-[0_0_0_2px_rgba(232,217,192,0.10)]"
                      : "bg-cream-muted/40",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setActiveTerminal(tab.id)}
                  className="min-w-0 truncate py-2 text-left hover:text-cream"
                  title={tab.title}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  onClick={() => closeTerminalTab(tab.id)}
                  aria-label={`Close ${tab.title}`}
                  className="grid size-4 place-items-center rounded text-cream-muted/60 hover:bg-charcoal-hover hover:text-cream"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => addTerminalTab()}
            aria-label="New terminal"
            title="New terminal"
            className="grid w-9 place-items-center border-r border-charcoal-border text-cream-muted hover:bg-charcoal-hover hover:text-cream"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 text-cream-muted">
          <button
            type="button"
            onClick={restartActive}
            aria-label="Restart terminal"
            title="Restart terminal"
            className="grid size-6 place-items-center rounded hover:bg-charcoal-hover hover:text-cream"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {hasBeenOpened
          ? terminalTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "h-full min-h-0 w-full",
                  tab.id === activeTerminalId ? "block" : "hidden",
                )}
              >
                <Suspense fallback={<div className="h-full bg-charcoal-bg" />}>
                  <XtermPane
                    cwd={rootPath}
                    env={env}
                    sessionKey={tab.sessionKey}
                    visible={tab.id === activeTerminalId}
                    onTitleChange={(title) => renameTerminalTab(tab.id, title.slice(0, 40))}
                  />
                </Suspense>
              </div>
            ))
          : null}
      </div>
    </section>
  );
}
