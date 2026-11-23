// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IconButton, Input, Pressable, SidePanelHeader } from "@misty/ui";
import { terminalTabTitle, useTerminalStore, type TerminalTab } from "./terminal_store";
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

export default function TerminalPanel({ chat, folder }: { chat: string; folder: string }) {
  const tabs = useTerminalStore((state) => state.tabsByChat[chat] ?? noTabs);
  const activeId = useTerminalStore((state) => state.activeByChat[chat]);
  const newTab = useTerminalStore((state) => state.newTab);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const renameTab = useTerminalStore((state) => state.renameTab);

  useEffect(() => {
    if (!tabs.length) newTab(chat, folder);
  }, [tabs.length, chat, folder, newTab]);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1];
  const closeActive = useCallback(() => {
    if (active) closeTab(chat, active.id);
  }, [active, closeTab, chat]);

  return (
    <div className="terminal-panel">
      <SidePanelHeader bar>
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
