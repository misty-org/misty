import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
import { dockTabs } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";

const WorkspaceTabIdContext = createContext<string | undefined>(undefined);

export function WorkspaceTabTitleProvider(props: {
  tabId: string | undefined;
  children: ReactNode;
}) {
  return createElement(WorkspaceTabIdContext.Provider, { value: props.tabId }, props.children);
}

/** Keeps one rendered workspace tab aligned with the content currently shown inside it. */
export function useWorkspaceTabTitle(tabId: string | undefined, title: string) {
  const contextualTabId = useContext(WorkspaceTabIdContext);
  const resolvedTabId = tabId || contextualTabId;
  useEffect(() => {
    const trimmed = title.trim();
    if (!resolvedTabId || !trimmed) return;
    const state = useWorkspaceStore.getState();
    const tab = dockTabs(state.layout.root).find((entry) => entry.id === resolvedTabId);
    if (tab && tab.title !== trimmed) state.renameTab(resolvedTabId, trimmed);
  }, [resolvedTabId, title]);
}
