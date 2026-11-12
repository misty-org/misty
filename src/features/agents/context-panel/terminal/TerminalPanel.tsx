// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IconButton, Input, Pressable } from "@/shared/ui";
import { terminalTabTitle, useTerminalStore, type TerminalTab } from "./terminalStore";
import { TerminalView } from "./TerminalView";
import "./terminal.css";

const noTabs: TerminalTab[] = [];

function TabTitle(props: { tab: TerminalTab; index: number; onRename(title: string): void }) {
  const [editing, setEditing] = useState(false);
  const title = terminalTabTitle(props.tab, props.index);
  const [draft, setDraft] = useState(title);
  if (!editing)
    return (
      <span
        className="terminal-tab-title"
        onDoubleClick={() => {
          setDraft(title);
          setEditing(true);
        }}
      >
        {title}
      </span>
    );
  const finish = (save: boolean) => {
    if (save) props.onRename(draft);
    setEditing(false);
  };
  return (
    <Input
      variant="bare"
      autoFocus
      aria-label="Terminal name"
      className="terminal-tab-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}

/**
 * The folder's terminals: a strip of tabs and one shell per tab, each running in the folder.
 * Shells outlive the panel: closing it, or switching tabs, leaves every shell running, and its
 * output is there when the tab shows again. A shell ends when its tab is closed. Double-click a
 * tab to rename it.
 */
export default function TerminalPanel({ folder }: { folder: string }) {
  const tabs = useTerminalStore((state) => state.tabsByFolder[folder] ?? noTabs);
  const activeId = useTerminalStore((state) => state.activeByFolder[folder]);
  const newTab = useTerminalStore((state) => state.newTab);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const renameTab = useTerminalStore((state) => state.renameTab);

  // The panel always shows a shell: opening it on a folder with no tabs starts the first one.
  useEffect(() => {
    if (!tabs.length) newTab(folder);
  }, [tabs.length, folder, newTab]);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1];
  const closeActive = useCallback(() => {
    if (active) closeTab(folder, active.id);
  }, [active, closeTab, folder]);

  return (
    <div className="terminal-panel">
      <div className="terminal-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((tab, index) => {
          const selected = tab.id === active?.id;
          return (
            <div key={tab.id} className="terminal-tab" data-selected={selected || undefined}>
              <Pressable
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="terminal-tab-select"
                onClick={() => selectTab(folder, tab.id)}
              >
                <TabTitle
                  tab={tab}
                  index={index}
                  onRename={(title) => renameTab(folder, tab.id, title)}
                />
              </Pressable>
              <IconButton
                label="Close terminal"
                size="2xs"
                shape="round"
                className="terminal-tab-close"
                onClick={() => closeTab(folder, tab.id)}
              >
                <X />
              </IconButton>
            </div>
          );
        })}
        <IconButton label="New terminal" size="xs" onClick={() => newTab(folder)}>
          <Plus />
        </IconButton>
      </div>
      {active ? (
        <TerminalView key={active.id} id={active.id} cwd={folder} onCloseTab={closeActive} />
      ) : (
        <div className="terminal-view" />
      )}
    </div>
  );
}
