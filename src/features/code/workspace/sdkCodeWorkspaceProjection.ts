import { create } from "zustand";
import {
  MistyViewStateSchema,
  type MistyAppSDK,
  type MistyViewState,
  type MistyWorkspaceSnapshot,
  type MistyWorkspaceView,
  type MistyWorkspaceUpdate,
} from "@misty/sdk";
import {
  parseCodeTabState,
  type WorkspaceDockNode,
  type WorkspaceTab,
} from "@/features/workspace/model";
import type { CodeWorkspaceState } from "./codeWorkspaceServices";

type Overlay = { key: symbol; viewId: string; change: Partial<MistyWorkspaceView> };
/** An app-owned projection, never a reference to the host's global workspace store. */
export function createSdkCodeWorkspaceProjection(
  misty: Pick<MistyAppSDK, "workspace">,
  options: {
    viewId: string;
    spaceId?: string;
    signal?: AbortSignal;
    report(error: unknown): void;
    serializeState?(state: MistyViewState): MistyViewState;
    prepareOpen?(
      state: MistyViewState,
    ): Promise<{ state: MistyViewState; cancel(): Promise<void> }>;
  },
) {
  let closed = false,
    revision = -1,
    pending = 0;
  let views: MistyWorkspaceView[] = [];
  let remove: (() => void) | undefined;
  let queue = Promise.resolve();
  const overlays: Overlay[] = [];
  const empty: WorkspaceDockNode = { type: "leaf", id: "code:empty", tabs: [], activeTabId: null };
  const assert = () => {
    if (closed || options.signal?.aborted) throw new Error("This Code workspace is closed.");
  };
  const own = (viewId: string) => {
    assert();
    const view = projected().find((view) => view.viewId === viewId);
    if (!view) throw new Error("This Code view is no longer open.");
    return view;
  };
  const projected = () =>
    views.map((view) =>
      overlays
        .filter((overlay) => overlay.viewId === view.viewId)
        .reduce((current, overlay) => ({ ...current, ...overlay.change }), view),
    );
  const tabFor = (view: MistyWorkspaceView): WorkspaceTab => ({
    id: view.viewId,
    surfaceId: "code",
    groupKey: "tool:code",
    instanceKey: "code",
    title: view.title,
    route: view.route,
    state: parseCodeTabState(view.state),
    sidebarVisible: view.sidebarVisible,
    createdAt: 0,
    lastFocusedAt: 0,
  });
  const render = () => {
    const current = projected();
    const panes = new Map<string, Extract<WorkspaceDockNode, { type: "leaf" }>>();
    for (const view of current) {
      let pane = panes.get(view.panelId);
      if (!pane) {
        pane = { type: "leaf", id: view.panelId, tabs: [], activeTabId: null };
        panes.set(view.panelId, pane);
      }
      pane.tabs.push(tabFor(view));
      if (view.active) pane.activeTabId = view.viewId;
    }
    // This tree represents only Code's views; it is not the host's full layout.
    const leaves = [...panes.values()];
    const root = leaves.reduce<WorkspaceDockNode>(
      (root, pane, index) =>
        index === 0
          ? pane
          : {
              type: "split",
              id: `code:projection:${index}`,
              direction: "horizontal",
              ratio: 0.5,
              first: root,
              second: pane,
            },
      empty,
    );
    store.setState({
      layout: { root, focusedPaneId: current.find((view) => view.focused)?.panelId ?? "" },
    });
  };
  const accept = (snapshot: MistyWorkspaceSnapshot) => {
    if (closed || snapshot.revision <= revision) return;
    revision = snapshot.revision;
    views = snapshot.views;
    render();
  };
  const refresh = async () => {
    assert();
    const snapshot = await misty.workspace.snapshot();
    assert();
    accept(snapshot);
  };
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    try {
      assert();
      if (pending >= 64) throw new Error("Too many pending Code workspace actions.");
    } catch (error) {
      return Promise.reject(error);
    }
    pending++;
    const result = queue.then(() => {
      assert();
      return task();
    });
    queue = result
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        pending--;
      });
    return result;
  };
  const dispatch = (task: () => Promise<unknown>, overlay?: Omit<Overlay, "key">) => {
    const item = overlay ? { ...overlay, key: Symbol() } : undefined;
    if (item) {
      overlays.push(item);
      render();
    }
    void enqueue(async () => {
      await task();
      if (!closed) await refresh();
    })
      .catch((error) => {
        if (!closed) options.report(error);
      })
      .finally(() => {
        if (item) {
          const index = overlays.indexOf(item);
          if (index >= 0) overlays.splice(index, 1);
        }
        if (!closed) render();
      });
  };
  const update = (change: MistyWorkspaceUpdate) => {
    own(change.viewId);
    if (change.title !== undefined) change = { ...change, title: change.title.slice(0, 160) };
    dispatch(() => misty.workspace.update(change), {
      viewId: change.viewId,
      change: {
        ...(change.state !== undefined ? { state: change.state } : {}),
        ...(change.title !== undefined ? { title: change.title } : {}),
        ...(change.sidebarVisible !== undefined ? { sidebarVisible: change.sidebarVisible } : {}),
      },
    });
  };
  const store = create<CodeWorkspaceState>(() => ({
    layout: { root: empty, focusedPaneId: "" },
    activeScopeKey: options.spaceId ? `space:${options.spaceId}` : "global",
    updateTabState: (viewId, state, title) =>
      update({
        viewId,
        state:
          options.serializeState?.(MistyViewStateSchema.parse(state)) ??
          MistyViewStateSchema.parse(state),
        ...(title !== undefined ? { title } : {}),
      }),
    renameTab: (viewId, title) => update({ viewId, title }),
    toggleSidebar: (viewId) => update({ viewId, sidebarVisible: !own(viewId).sidebarVisible }),
    focusTab: (viewId) => {
      own(viewId);
      dispatch(() => misty.workspace.focus(viewId));
      return true;
    },
    closeTab: (viewId) => {
      own(viewId);
      dispatch(async () => {
        await misty.workspace.close(viewId);
        if (viewId === options.viewId) close();
      });
      return true;
    },
    dockTab: (viewId, panelId, zone) => {
      own(viewId);
      const target = projected().find((view) => view.panelId === panelId);
      if (!target) throw new Error("Choose a panel containing a Code view.");
      dispatch(() =>
        misty.workspace.place({
          viewId,
          targetViewId: target.viewId,
          placement: zone === "center" ? "tab" : zone,
        }),
      );
      return true;
    },
    openSurface: (request) =>
      enqueue(async () => {
        if (request.surfaceId !== "code" || request.groupKey !== "tool:code")
          throw new Error("That app cannot be opened from this Code view yet.");
        const caller = own(options.viewId);
        const destination = request.paneId
          ? projected().find((view) => view.panelId === request.paneId)
          : caller;
        if (!destination) throw new Error("The destination Code panel is closed.");
        const initial = MistyViewStateSchema.parse(request.state ?? null);
        const prepared = await options.prepareOpen?.(initial);
        let result: { viewId: string };
        try {
          assert();
          result = await misty.workspace.open({
            route: request.route,
            state: prepared?.state ?? initial,
            title: request.title.slice(0, 160),
            sidebarVisible: request.sidebarVisible,
          });
        } catch (error) {
          await prepared?.cancel().catch(() => undefined);
          throw error;
        }
        assert();
        if (destination.panelId !== caller.panelId)
          await misty.workspace.place({
            viewId: result.viewId,
            targetViewId: destination.viewId,
            placement: "tab",
          });
        await refresh();
        return tabFor(own(result.viewId));
      }),
  }));
  const close = () => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", close);
    remove?.();
    remove = undefined;
    views = [];
    overlays.splice(0);
    store.setState({ layout: { root: empty, focusedPaneId: "" } });
  };
  options.signal?.addEventListener("abort", close, { once: true });
  const ready = (async () => {
    assert();
    const unsubscribe = await misty.workspace.subscribe(accept);
    if (closed || options.signal?.aborted) {
      unsubscribe();
      assert();
    }
    remove = unsubscribe;
    await refresh();
    own(options.viewId);
  })().catch((error) => {
    close();
    throw error;
  });
  return {
    store,
    viewState: (viewId: string) => own(viewId).state,
    ready,
    refresh,
    close,
    async settled() {
      await queue;
    },
  };
}
