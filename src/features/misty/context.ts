import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { currentVirtualWindows } from "@/features/workspace/virtualWindows";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import type { AiContextReference, AiSelectionSnapshot } from "@/features/ai-surface/types";
import type { GlobalAiContextRef } from "@/features/global-search/types";

export interface MistyContextTarget {
  kind: "workspace" | "window" | "tab" | "pane" | "view";
  spaceId: string;
  windowId?: string;
  tabId?: string;
  paneId?: string;
  viewId?: string;
}
export interface MistyContextSnapshot {
  context: GlobalAiContextRef[];
  selection?: AiSelectionSnapshot;
  paneId?: string;
}
export function mistyContextRef(ref: AiContextReference): GlobalAiContextRef {
  return { ...ref, source: "current", attached: true };
}
export function contextOptions(
  spaceId: string,
): Array<{ label: string; target: MistyContextTarget }> {
  const state = useWorkspaceStore.getState();
  if (spaceId || state.activeScopeKey !== "global") return [];
  const result: Array<{ label: string; target: MistyContextTarget }> = [
    { label: "Entire workspace", target: { kind: "workspace", spaceId: "" } },
  ];
  for (const window of currentVirtualWindows(state)) {
    const base = { spaceId, windowId: window.id };
    result.push({ label: window.title, target: { ...base, kind: "window" } });
    for (const tab of layoutTabs(window.layout)) {
      result.push({
        label: `${window.title} / ${tab.title || "Tab"}`,
        target: { ...base, kind: "tab", tabId: tab.id },
      });
      for (const pane of dockLeaves(tab.root)) {
        const view = pane.tabs.find((view) => view.id === pane.activeTabId) ?? pane.tabs[0];
        if (view)
          result.push({
            label: `${window.title} / ${tab.title || "Tab"} / ${view.title}`,
            target: { ...base, kind: "pane", tabId: tab.id, paneId: pane.id },
          });
      }
    }
  }
  return result;
}
export function resolveMistyContext(
  accountId: string,
  spaceId: string,
  targets: MistyContextTarget[] = [],
): MistyContextSnapshot {
  const state = useWorkspaceStore.getState();
  if (spaceId || state.activeScopeKey !== "global") {
    if (targets.length)
      throw new Error("Start a new conversation to attach browser workspace context.");
    // Preserve historical conversations without silently adding today's workspace.
    return { context: [] };
  }
  if (
    targets.some(
      (target) =>
        target.spaceId || !["workspace", "window", "tab", "pane", "view"].includes(target.kind),
    )
  )
    throw new Error("Attach context from the current browser workspace.");
  const windows = currentVirtualWindows(state);
  const requested = targets.length
    ? targets
    : [
        {
          kind: "pane" as const,
          spaceId,
          windowId: state.activeVirtualWindowId,
          paneId: state.layout.focusedPaneId,
        },
      ];
  const context: GlobalAiContextRef[] = [];
  let selection: AiSelectionSnapshot | undefined;
  let paneId: string | undefined;
  const visited = new Set<string>();
  for (const target of requested) {
    const scopeStart = context.length;
    let found = false;
    for (const window of windows) {
      if (target.kind === "window" && target.windowId && target.windowId !== window.id) continue;
      for (const tab of layoutTabs(window.layout)) {
        if (target.kind === "tab" && target.tabId && target.tabId !== tab.id) continue;
        for (const pane of dockLeaves(tab.root)) {
          const view = pane.tabs.find((view) => view.id === pane.activeTabId) ?? pane.tabs[0]; // History snapshots are deliberately excluded.
          if (
            !view ||
            (target.paneId && target.paneId !== pane.id) ||
            (target.viewId && target.viewId !== view.id)
          )
            continue;
          found = true;
          if (visited.has(view.id)) continue;
          visited.add(view.id);
          const registration =
            useAiSurfaceStore.getState().registrations[`${accountId}:${pane.id}`];
          if (!registration || registration.accountId !== accountId) {
            context.push(
              mistyContextRef({
                kind: "workspace-view",
                id: view.id,
                title: view.title,
                spaceId,
                privacy: "device",
                metadata: {
                  availability: "Open this pane to access its content",
                  windowId: window.id,
                  tabId: tab.id,
                  paneId: pane.id,
                },
              }),
            );
            continue;
          }
          const refs = registration.adapter.getContext();
          if (refs.some((ref) => ref.spaceId))
            throw new Error("The pane contains historical context. Open its current browser view.");
          context.push(...refs.map(mistyContextRef));
          if (requested.length === 1 && ["pane", "view"].includes(target.kind)) {
            selection = registration.adapter.getSelection?.() ?? undefined;
            paneId = pane.id;
          }
        }
      }
    }
    if (found && ["workspace", "window", "tab"].includes(target.kind)) {
      const members = context.splice(scopeStart);
      context.push(
        mistyContextRef({
          kind: "workspace.scope",
          id: target.tabId || target.windowId || "browser-workspace",
          title:
            target.kind === "workspace"
              ? "Attached workspace"
              : target.kind === "tab"
                ? "Attached tab"
                : "Attached window",
          spaceId,
          privacy: "device",
          metadata: {
            members: JSON.stringify(members),
            ...(target.windowId ? { windowId: target.windowId } : {}),
            ...(target.tabId ? { tabId: target.tabId } : {}),
          },
        }),
      );
    }
    if (!found && targets.length)
      throw new Error("An attached context is closed. Remove it or reopen its source.");
  }
  if (context.length > 11)
    throw new Error("Attach at most 11 sources, or choose their containing tab or window.");
  return structuredClone({ context, selection, paneId });
}
