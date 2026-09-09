import type { SdkCodeProjectReference } from "./sdkCodeProjectReference";
import type { SdkCodeProjectHandoff } from "./sdkCodeProjectHandoff";
import type { MistyAppSDK } from "@misty/sdk";
import { openSdkCodeProject } from "./sdkCodeProject";
import { createSdkCodeSessionState } from "./sdkCodeSessionState";

type Project = NonNullable<Awaited<ReturnType<typeof openSdkCodeProject>>>;
/** File access and editor state for one downloadable Code mount. No host stores or native imports. */
export function createSdkCodeRuntime(
  misty: Pick<MistyAppSDK, "files">,
  signal?: AbortSignal,
  shared?: ReturnType<typeof createSdkCodeSessionState>,
) {
  const lifetime = new AbortController();
  const state = shared ?? createSdkCodeSessionState();
  const { store, editor, reads, writes, pendingContents, flushers } = state;
  const owner = crypto.randomUUID();
  const viewKey = (viewId: string) => `${owner}:${viewId}`;
  const ownedViews = new Set<string>();
  const usedProjects = new Set<string>();
  const projects = new Map<string, Project>();
  const observers = new Map<string, Set<() => void>>();
  const revisions = new Map<string, number>();
  const observationErrors = new Map<string, string>();
  const refreshing = new Map<string, Promise<void>>();
  const refreshAgain = new Set<string>();
  const deferredRefreshes = new Set<string>();
  const assert = () => {
    if (lifetime.signal.aborted || signal?.aborted || state.signal.aborted)
      throw new Error("This Code view is closed.");
  };
  const owned = (root: string) => {
    assert();
    const project = projects.get(root);
    if (!project) throw new Error("This Code project is no longer open.");
    return project;
  };
  const invalidate = (root: string) => {
    if (lifetime.signal.aborted || !projects.has(root)) return;
    revisions.set(root, (revisions.get(root) ?? 0) + 1);
    for (const listener of [...(observers.get(root) ?? [])]) {
      try {
        listener();
      } catch {
        /* One UI subscriber cannot interrupt the refresh. */
      }
    }
  };
  const refresh = (root: string): Promise<void> => {
    const project = owned(root);
    const pending = refreshing.get(root);
    if (pending) {
      refreshAgain.add(root);
      return pending;
    }
    const next = (async () => {
      do {
        refreshAgain.delete(root);
        for (const path of Object.keys(store.getState().projectBuffers[root] ?? {})) {
          owned(root);
          const key = JSON.stringify([root, path]);
          if (pendingContents.has(key)) {
            deferredRefreshes.add(root);
            continue;
          }
          if (reads.has(key) || writes.has(key)) continue;
          try {
            const writeVersion = state.writeVersions.get(key);
            const file = await project.readText(path);
            owned(root);
            if (state.writeVersions.get(key) !== writeVersion) continue;
            const current = store.getState().projectBuffers[root]?.[path];
            if (pendingContents.has(key)) {
              deferredRefreshes.add(root);
              continue;
            }
            if (!current || current.loading || writes.has(key)) continue;
            if (current.contents !== current.savedContents) {
              if (file.contents !== current.savedContents)
                store.getState().patchBuffer(root, path, {
                  error: "This file changed on disk while you had unsaved changes.",
                });
            } else
              store.getState().patchBuffer(root, path, {
                ...file,
                savedContents: file.contents,
                loaded: true,
                error: null,
              });
          } catch (error) {
            if (
              !lifetime.signal.aborted &&
              projects.get(root) === project &&
              store.getState().projectBuffers[root]?.[path]
            )
              store.getState().patchBuffer(root, path, {
                error: error instanceof Error ? error.message : "Could not refresh this file.",
              });
          }
        }
      } while (refreshAgain.has(root));
    })().finally(() => {
      if (refreshing.get(root) === next) refreshing.delete(root);
    });
    refreshing.set(root, next);
    return next;
  };
  const discardUnopenedProject = async (project: Project) => {
    if (projects.get(project.root) !== project) {
      await project.close();
      return;
    }
    const current = store.getState();
    if (
      [...ownedViews].some(
        (id) => state.viewOwners.get(id) === owner && current.views[id]?.rootPath === project.root,
      ) ||
      usedProjects.has(project.root)
    )
      throw new Error("This project is already being used by an editor.");
    projects.delete(project.root);
    observers.delete(project.root);
    revisions.delete(project.root);
    observationErrors.delete(project.root);
    await project.close();
  };
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    signal?.removeEventListener("abort", abort);
    state.signal.removeEventListener("abort", abort);
    // Flush only this owner's pending edits; never copy a stale peer DOM over shared data.
    for (const [key, listeners] of flushers) {
      for (const [id, flush] of listeners)
        if (id.startsWith(`${owner}:`)) {
          if (pendingContents.get(key)?.has(id)) flush();
          listeners.delete(id);
          pendingContents.get(key)?.delete(id);
        }
      if (!listeners.size) flushers.delete(key);
      if (!pendingContents.get(key)?.size) pendingContents.delete(key);
    }
    lifetime.abort();
    const opened = [...projects.values()];
    projects.clear();
    observers.clear();
    revisions.clear();
    observationErrors.clear();
    refreshing.clear();
    refreshAgain.clear();
    deferredRefreshes.clear();
    for (const id of ownedViews) {
      if (state.viewOwners.get(id) !== owner) continue;
      state.viewOwners.delete(id);
      store.setState((current) => {
        const views = { ...current.views };
        delete views[id];
        return { views };
      });
      editor.getState().clearGroup(id);
    }
    ownedViews.clear();
    usedProjects.clear();
    if (!shared) state.close();
    closing = Promise.all(opened.map((project) => project.close())).then(() => undefined);
    return closing;
  };
  const abort = () => {
    void close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  state.signal.addEventListener("abort", abort, { once: true });
  if (signal?.aborted || state.signal.aborted) abort();
  const runtime = {
    store,
    editor,
    sharedState: shared,
    signal: lifetime.signal,
    preparePathChange(root: string, path: string) {
      owned(root);
      for (const file of Object.keys(store.getState().projectBuffers[root] ?? {})) {
        if (file !== path && !file.startsWith(`${path}/`)) continue;
        runtime.flushBuffer(root, file);
        const key = JSON.stringify([root, file]);
        if (reads.has(key) || writes.has(key)) throw new Error("Wait for this file to finish loading or saving before moving it.");
      }
    },
    retargetPath(root: string, from: string, to: string) {
      owned(root);
      const change = (path: string) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
      store.setState(current => ({
        projectBuffers: {...current.projectBuffers, [root]: Object.fromEntries(Object.entries(current.projectBuffers[root] ?? {}).map(([path, buffer]) => {
          const next = change(path);
          return [next, {...buffer, path:next, name:next.slice(next.lastIndexOf("/")+1)}];
        }))},
        views: Object.fromEntries(Object.entries(current.views).map(([id, view]) => [id, view.rootPath === root ? {...view, activeFilePath:view.activeFilePath ? change(view.activeFilePath) : null, history:view.history.map(change)} : view])),
        projects: Object.fromEntries(Object.entries(current.projects).map(([id, project]) => [id, id === root ? {...project, expandedFolders:project.expandedFolders.map(change), marks:project.marks.map(change), recents:project.recents.map(change)} : project])),
      }));
      invalidate(root);
    },
    ownView(viewId: string) {
      assert();
      ownedViews.add(viewId);
      state.viewOwners.set(viewId, owner);
    },
    close,
    project: owned,
    openProjects: () => [...projects.values()],
    discardUnopenedProject,
    hasProject(root: string) {
      return !lifetime.signal.aborted && projects.has(root);
    },
    refresh,
    registerBufferFlusher(root: string, path: string, viewId: string, flush: () => void) {
      owned(root);
      const key = JSON.stringify([root, path]);
      let listeners = flushers.get(key);
      if (!listeners) flushers.set(key, (listeners = new Map()));
      const id = viewKey(viewId);
      listeners.set(id, flush);
      return () => {
        if (listeners.get(id) === flush) listeners.delete(id);
        if (!listeners.size && flushers.get(key) === listeners) flushers.delete(key);
      };
    },
    flushBuffer(root: string, path: string) {
      owned(root);
      const key = JSON.stringify([root, path]);
      for (const viewId of [...(pendingContents.get(key) ?? [])]) {
        const flush = flushers.get(key)?.get(viewId);
        if (!flush)
          throw new Error("Wait for the current editor changes before applying this edit.");
        flush();
      }
    },
    pendingContent(root: string, path: string, viewId: string, pending: boolean) {
      if (lifetime.signal.aborted || !projects.has(root)) return;
      const key = JSON.stringify([root, path]);
      if (pending) {
        const views = pendingContents.get(key) ?? new Set<string>();
        views.add(viewKey(viewId));
        pendingContents.set(key, views);
      } else {
        const views = pendingContents.get(key);
        views?.delete(viewKey(viewId));
        if (views?.size) return;
        pendingContents.delete(key);
        if (deferredRefreshes.delete(root)) void refresh(root).catch(() => undefined);
      }
    },
    projectRevision(root: string) {
      owned(root);
      return revisions.get(root) ?? 0;
    },
    observationError(root: string) {
      owned(root);
      return observationErrors.get(root) ?? null;
    },
    subscribeProject(root: string, listener: () => void) {
      owned(root);
      let listeners = observers.get(root);
      if (!listeners) observers.set(root, (listeners = new Set()));
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async openProject(
      options: {
        write?: boolean;
        handoff?: SdkCodeProjectHandoff;
        reference?: SdkCodeProjectReference;
        activate?: boolean;
        signal?: AbortSignal;
      } = {},
    ) {
      assert();
      if (options.signal?.aborted) throw new Error("Folder selection was cancelled.");
      const project = await openSdkCodeProject(misty, { ...options, signal: lifetime.signal });
      if (!project) return null;
      try {
        assert();
        if (options.signal?.aborted) throw new Error("Folder selection was cancelled.");
      } catch (error) {
        await project.close();
        throw error;
      }
      if (projects.has(project.root)) {
        await project.close();
        throw new Error("This Code project is already open in this view.");
      }
      projects.set(project.root, project);
      const watchError = (error: unknown) => {
        if (lifetime.signal.aborted || !projects.has(project.root)) return;
        observationErrors.set(
          project.root,
          error instanceof Error ? error.message : "Folder observation stopped.",
        );
        invalidate(project.root);
      };
      await project
        .watch(() => {
          invalidate(project.root);
          void refresh(project.root).catch(watchError);
        }, watchError)
        .catch(watchError);
      if (lifetime.signal.aborted || options.signal?.aborted) {
        await discardUnopenedProject(project);
        throw new Error("Folder selection was cancelled.");
      }
      // Shared sessions use explicit per-view workspace state, never legacy root adoption.
      if (options.activate !== false && !shared) store.getState().setRootPath(project.root);
      return project;
    },
    async ensureFile(root: string, path: string): Promise<void> {
      const project = owned(root);
      usedProjects.add(root);
      const name = path.slice(path.lastIndexOf("/") + 1);
      const existing = store.getState().projectBuffers[root]?.[path];
      if (!existing)
        store.getState().ensureBuffer(root, {
          path,
          name,
          contents: "",
          savedContents: "",
          lineEnding: "lf",
          readonly: !project.writable,
          loading: true,
          error: null,
        });
      const key = JSON.stringify([root, path]);
      if (
        existing &&
        !existing.loading &&
        (!existing.error || existing.contents !== existing.savedContents)
      )
        return;
      let pending = reads.get(key);
      if (pending && pending.signal !== lifetime.signal) {
        // A peer may finish loading, or close before it can publish. Retry with
        // this view's own grant after the old operation has actually settled.
        try {
          await pending.promise;
        } catch (error) {
          if (!pending.signal.aborted) throw error;
        }
        owned(root);
        return runtime.ensureFile(root, path);
      }
      if (!pending) {
        const record = { signal: lifetime.signal, promise: undefined as never as Promise<void> };
        record.promise = abortableRead(
          (async () => {
            try {
              const file = await project.readText(path);
              owned(root);
              store.getState().patchBuffer(root, path, {
                ...file,
                savedContents: file.contents,
                loading: false,
                loaded: true,
                error: null,
              });
            } catch (error) {
              if (!lifetime.signal.aborted && projects.get(root) === project)
                store.getState().patchBuffer(root, path, {
                  loading: false,
                  error: error instanceof Error ? error.message : "Could not open this file.",
                });
              throw error;
            }
          })(),
          lifetime.signal,
        ).finally(() => {
          if (reads.get(key) === record) reads.delete(key);
        });
        reads.set(key, record);
        pending = record;
      }
      await pending.promise;
    },
    async openFile(root: string, path: string, viewId: string): Promise<void> {
      owned(root);
      ownedViews.add(viewId);
      state.viewOwners.set(viewId, owner);
      const loading = runtime.ensureFile(root, path);
      store.getState().setActiveFile(root, viewId, path);
      await loading;
    },
    async saveFile(root: string, path: string, submittedContents?: string) {
      const project = owned(root);
      const buffer = store.getState().projectBuffers[root]?.[path];
      if (!buffer || buffer.loading || buffer.readonly || !project.writable)
        throw new Error("This file is not ready for writing.");
      const contents = submittedContents ?? buffer.contents;
      const { lineEnding } = buffer;
      const key = JSON.stringify([root, path]);
      state.writeVersions.set(key, (state.writeVersions.get(key) ?? 0) + 1);
      const previous = writes.get(key) ?? Promise.resolve();
      const pending = previous
        .catch(() => undefined)
        .then(async () => {
          owned(root);
          try {
            const metadata = await project.writeText(path, contents, lineEnding);
            owned(root);
            // Mark only the submitted contents saved; edits made during the write stay dirty.
            store
              .getState()
              .patchBuffer(root, path, { ...metadata, savedContents: contents, error: null });
          } catch (error) {
            if (!lifetime.signal.aborted && projects.get(root) === project)
              store.getState().patchBuffer(root, path, {
                error: error instanceof Error ? error.message : "Could not save this file.",
              });
            throw error;
          }
        });
      writes.set(key, pending);
      try {
        await pending;
      } finally {
        if (writes.get(key) === pending) writes.delete(key);
      }
    },
  };
  return runtime;
}

function abortableRead<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("This Code view is closed."));
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
