import type { WorkspaceDockNode, WorkspaceLayout, WorkspaceView } from "./model";
function leaves(node: WorkspaceDockNode): Array<{ id: string; views: WorkspaceView[] }> {
  return node.type === "leaf" ? [node] : [...leaves(node.first), ...leaves(node.second)];
}
/** Keep the destination group's identity on merge; a partial move creates a new group. */
export function reconcileGroupIdentities(
  layout: WorkspaceLayout,
  previous?: WorkspaceLayout,
): WorkspaceLayout {
  const before = previous ? leaves(previous.root) : [];
  const after = leaves(layout.root);
  const visit = (node: WorkspaceDockNode): WorkspaceDockNode => {
    if (node.type !== "leaf")
      return { ...node, first: visit(node.first), second: visit(node.second) };
    const ids = new Map<string, string>();
    for (const tab of node.views) {
      if (ids.has(tab.groupKey)) continue;
      const same = node.views.filter((t) => t.groupKey === tab.groupKey);
      const original = before
        .find((p) => p.id === node.id)
        ?.views.find((t) => t.groupKey === tab.groupKey && same.some((s) => s.id === t.id));
      let id = original?.groupInstanceId ?? same.find((t) => t.groupInstanceId)?.groupInstanceId;
      if (
        id &&
        !original &&
        before.some(
          (p) =>
            p.id !== node.id &&
            p.views.some((t) => t.groupInstanceId === id) &&
            after.some(
              (next) => next.id === p.id && next.views.some((t) => t.groupInstanceId === id),
            ),
        )
      )
        id = undefined;
      ids.set(
        tab.groupKey,
        id ?? (previous ? `group:${crypto.randomUUID()}` : `group:${node.id}:${tab.groupKey}`),
      );
    }
    const tabs = node.views.map((t) =>
      t.groupInstanceId === ids.get(t.groupKey)
        ? t
        : { ...t, groupInstanceId: ids.get(t.groupKey)! },
    );
    return tabs.every((t, i) => t === node.views[i]) ? node : { ...node, views: tabs };
  };
  return { ...layout, root: visit(layout.root) };
}
