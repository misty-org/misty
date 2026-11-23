import { allLayoutViews } from "../panes/layout_tabs";
import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
import { useWorkspaceStore } from "./use_workspace_store";

const WorkspaceViewIdContext = createContext<string | undefined>(undefined);

export function WorkspaceViewTitleProvider(props: {
  tabId: string | undefined;
  children: ReactNode;
}) {
  return createElement(WorkspaceViewIdContext.Provider, { value: props.tabId }, props.children);
}

export function useWorkspaceViewTitle(tabId: string | undefined, title: string) {
  const contextualViewId = useContext(WorkspaceViewIdContext);
  const resolvedTabId = tabId || contextualViewId;
  useEffect(() => {
    const trimmed = title.trim();
    if (!resolvedTabId || !trimmed) return;
    const state = useWorkspaceStore.getState();
    const tab = allLayoutViews(state.layout).find((entry) => entry.id === resolvedTabId);
    if (tab && tab.title !== trimmed) state.renameView(resolvedTabId, trimmed);
  }, [resolvedTabId, title]);
}
