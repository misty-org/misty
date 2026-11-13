// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IconButton, Input, Pressable, SidePanelHeader } from "@/shared/ui";
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
 * The chat's terminals: a strip of tabs and one shell per tab. Each chat has its own, so two
 * chats side by side never share a shell. A new tab runs in the chat's folder, and a tab keeps
 * the folder it was opened in. Shells outlive the panel: closing it, or switching tabs or chats,
 * leaves every shell running, and its output is there when the tab shows again. A shell ends
 * when its tab is closed. Double-click a tab to rename it.
 */
export default function TerminalPanel({ chat, folder }: { chat: string; folder: string }) {
  const tabs = useTerminalStore((state) => state.tabsByChat[chat] ?? noTabs);
  const activeId = useTerminalStore((state) => state.activeByChat[chat]);
  const newTab = useTerminalStore((state) => state.newTab);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const renameTab = useTerminalStore((state) => state.renameTab);

  // The panel always shows a shell: opening it on a chat with no tabs starts the first one.
  useEffect(() => {
    if (!tabs.length) newTab(chat, folder);
  }, [tabs.length, chat, folder, newTab]);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1];
  const closeActive = useCallback(() => {
    if (active) closeTab(chat, active.id);
  }, [active, closeTab, chat]);

  return (
    <div className="terminal-panel">
      {/* The tabs are the panel's header row. */}
      <SidePanelHeader>
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
                  onClick={() => selectTab(chat, tab.id)}
                >
                  <TabTitle
                    tab={tab}
                    index={index}
                    onRename={(title) => renameTab(chat, tab.id, title)}
                  />
                </Pressable>
                <IconButton
                  label="Close terminal"
                  size="sm"
                  className="terminal-tab-close"
                  onClick={() => closeTab(chat, tab.id)}
                >
                  <X />
                </IconButton>
              </div>
            );
          })}
          <IconButton label="New terminal" onClick={() => newTab(chat, folder)}>
            <Plus />
          </IconButton>
        </div>
      </SidePanelHeader>
      {active ? (
        <TerminalView key={active.id} id={active.id} cwd={active.folder} onCloseTab={closeActive} />
      ) : (
        <div className="terminal-view" />
      )}
    </div>
  );
}
