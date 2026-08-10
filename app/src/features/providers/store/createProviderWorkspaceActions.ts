import {
  providersConfigPaths,
  providersRefresh,
  providersSaveRemote,
  providersSelectRemote,
  providersSnapshot,
  providersTestRemote,
} from "@/services/backend";
import { errorText } from "@/shared/lib/format";
import type { ProvidersStore } from "../model/stores/providers/interfaces/useProvidersStore";
import { updateTokenField } from "../providerUtils";

import {
  refreshCloudConnectionLeases,
  scheduleCloudLeaseRefresh,
  type ProvidersGet,
  type ProvidersSet,
} from "./providerConnectionHelpers";
import {
  bumpRemoteRevisions,
  createProvidersWorkspaceState,
  isProviderWorkspaceStale,
  isValidRemoteName,
  isWorkspaceDirty,
  pruneRemoteDraftCacheToRemotes,
  removeRemoteDraftCache,
  revisionForRemote,
  setWorkspaceState,
} from "./providerWorkspaceState";

let providersLoadPromise: Promise<void> | null = null;

export function createProviderWorkspaceActions(
  set: ProvidersSet,
  get: ProvidersGet,
): Pick<
  ProvidersStore,
  | "ensureWorkspace"
  | "discardWorkspaces"
  | "reloadWorkspaceRemote"
  | "load"
  | "selectRemoteInWorkspace"
  | "setWorkspaceDraftName"
  | "setWorkspaceConfigField"
  | "setWorkspaceTokenField"
  | "setWorkspaceTokenVisible"
  | "saveWorkspaceRemote"
  | "testWorkspaceConnection"
  | "loadWorkspaceConfigPaths"
> {
  return {
    ensureWorkspace: (workspaceId) => {
      set((state) =>
        state.workspaces[workspaceId]
          ? state
          : {
              workspaces: {
                ...state.workspaces,
                [workspaceId]: createProvidersWorkspaceState(),
              },
            },
      );
    },

    discardWorkspaces: (workspaceIds) => {
      if (workspaceIds.length === 0) return;
      set((state) => {
        let changed = false;
        const next = { ...state.workspaces };
        for (const workspaceId of workspaceIds) {
          if (workspaceId in next) {
            delete next[workspaceId];
            changed = true;
          }
        }
        return changed ? { workspaces: next } : state;
      });
    },

    reloadWorkspaceRemote: async (workspaceId) => {
      const workspace = get().workspaces[workspaceId];
      const name = workspace?.loadingRemoteName ?? workspace?.draft?.originalName;
      if (!name) return;
      await get().selectRemoteInWorkspace(workspaceId, name, false, true);
    },

    load: async (refresh = false) => {
      if (!refresh && get().providers) return;
      if (providersLoadPromise) return providersLoadPromise;
      providersLoadPromise = (async () => {
        set({ loading: true, error: null });
        try {
          await refreshCloudConnectionLeases();
          scheduleCloudLeaseRefresh();
          const next = refresh ? await providersRefresh() : await providersSnapshot();
          set({
            providers: next,
            remoteDraftCache: pruneRemoteDraftCacheToRemotes(get().remoteDraftCache, next.remotes),
          });
        } catch (error) {
          set({ error: errorText(error) });
        } finally {
          providersLoadPromise = null;
          set({ loading: false });
        }
      })();
      return providersLoadPromise;
    },

    selectRemoteInWorkspace: async (workspaceId, name, guardDirty = true, forceReload = false) => {
      get().ensureWorkspace(workspaceId);
      const workspace = get().workspaces[workspaceId] ?? createProvidersWorkspaceState();
      if (
        guardDirty &&
        isWorkspaceDirty(workspace) &&
        !window.confirm("Discard unsaved remote edits?")
      ) {
        return;
      }
      const revision = revisionForRemote(get().remoteRevisions, name);
      const cached = get().remoteDraftCache[name];
      if (!forceReload && cached && cached.revision === revision) {
        setWorkspaceState(set, workspaceId, {
          draft: cached.draft,
          originalDraft: cached.draft,
          tokenVisible: false,
          loadingRemoteName: null,
          loadedRemoteRevision: cached.revision,
          error: null,
          message: null,
        });
        return;
      }
      setWorkspaceState(set, workspaceId, {
        error: null,
        message: null,
        draft: null,
        originalDraft: null,
        tokenVisible: false,
        loadingRemoteName: name,
        loadedRemoteRevision: revision,
      });
      try {
        const nextDraft = await providersSelectRemote(name);
        const current = get().workspaces[workspaceId];
        if (current?.loadingRemoteName !== name) {
          return;
        }
        const loadedRevision = revisionForRemote(get().remoteRevisions, nextDraft.originalName);
        set((state) => ({
          remoteDraftCache: {
            ...state.remoteDraftCache,
            [nextDraft.originalName]: {
              draft: nextDraft,
              revision: loadedRevision,
            },
          },
        }));
        setWorkspaceState(set, workspaceId, {
          draft: nextDraft,
          originalDraft: nextDraft,
          loadingRemoteName: null,
          loadedRemoteRevision: loadedRevision,
        });
      } catch (error) {
        const current = get().workspaces[workspaceId];
        if (current?.loadingRemoteName === name) {
          setWorkspaceState(set, workspaceId, { loadingRemoteName: null });
        }
        setWorkspaceState(set, workspaceId, { error: errorText(error), message: null });
      }
    },

    setWorkspaceDraftName: (workspaceId, name) => {
      const workspace = get().workspaces[workspaceId];
      if (!workspace?.draft) return;
      setWorkspaceState(set, workspaceId, { draft: { ...workspace.draft, name } });
    },

    setWorkspaceConfigField: (workspaceId, key, value) => {
      const workspace = get().workspaces[workspaceId];
      if (!workspace?.draft || key === "type") return;
      setWorkspaceState(set, workspaceId, {
        draft: { ...workspace.draft, config: { ...workspace.draft.config, [key]: value } },
      });
    },

    setWorkspaceTokenField: (workspaceId, key, value) => {
      const workspace = get().workspaces[workspaceId];
      if (!workspace?.draft) return;
      get().setWorkspaceConfigField(
        workspaceId,
        "token",
        updateTokenField(workspace.draft.config.token ?? "", key, value),
      );
    },

    setWorkspaceTokenVisible: (workspaceId, tokenVisible) =>
      setWorkspaceState(set, workspaceId, { tokenVisible }),

    saveWorkspaceRemote: async (workspaceId) => {
      const workspace = get().workspaces[workspaceId];
      if (!workspace?.draft || !workspace.originalDraft || !isValidRemoteName(workspace.draft))
        return;
      if (
        isProviderWorkspaceStale(workspace, get().remoteRevisions, get().providers?.remotes ?? [])
      ) {
        setWorkspaceState(set, workspaceId, {
          error: "This remote changed in another pane. Reload it before saving.",
          message: null,
        });
        return;
      }
      set({ working: true });
      setWorkspaceState(set, workspaceId, { error: null, message: null });
      try {
        const saved = await providersSaveRemote({
          originalName: workspace.originalDraft.originalName,
          name: workspace.draft.name,
          parameters: workspace.draft.config,
        });
        const remoteRevisions = bumpRemoteRevisions(get().remoteRevisions, [
          workspace.originalDraft.originalName,
          saved.originalName,
        ]);
        setWorkspaceState(set, workspaceId, {
          draft: saved,
          originalDraft: saved,
          loadedRemoteRevision: revisionForRemote(remoteRevisions, saved.originalName),
        });
        set({
          providers: await providersRefresh(),
          remoteDraftCache: {
            ...removeRemoteDraftCache(get().remoteDraftCache, workspace.originalDraft.originalName),
            [saved.originalName]: {
              draft: saved,
              revision: revisionForRemote(remoteRevisions, saved.originalName),
            },
          },
          remoteRevisions,
        });
        setWorkspaceState(set, workspaceId, { message: "Remote saved.", error: null });
      } catch (error) {
        setWorkspaceState(set, workspaceId, { error: errorText(error), message: null });
      } finally {
        set({ working: false });
      }
    },

    testWorkspaceConnection: async (workspaceId) => {
      const workspace = get().workspaces[workspaceId];
      const draft = workspace?.draft;
      if (!draft) return;
      set({ working: true });
      setWorkspaceState(set, workspaceId, { error: null, message: null });
      try {
        const result = await providersTestRemote(draft.name);
        setWorkspaceState(set, workspaceId, { message: result.message, error: null });
        if (result.aboutJson) {
          const nextDraft = {
            ...draft,
            aboutJson: result.aboutJson,
            lastCheckedUnix: result.checkedUnix,
          };
          setWorkspaceState(set, workspaceId, {
            draft: nextDraft,
          });
          if (!isWorkspaceDirty({ draft: nextDraft, originalDraft: workspace.originalDraft })) {
            set((state) => ({
              remoteDraftCache: {
                ...state.remoteDraftCache,
                [nextDraft.originalName]: {
                  draft: nextDraft,
                  revision: workspace.loadedRemoteRevision,
                },
              },
            }));
          }
        }
      } catch (error) {
        setWorkspaceState(set, workspaceId, { error: errorText(error), message: null });
      } finally {
        set({ working: false });
      }
    },

    // Populates the config/cache/temp path panel. Runs quietly: a failure here
    // only costs a reference panel, so it must not clobber pane feedback from a
    // save or connection test.
    loadWorkspaceConfigPaths: async (workspaceId) => {
      if (get().workspaces[workspaceId]?.configPaths) return;
      try {
        const paths = await providersConfigPaths();
        setWorkspaceState(set, workspaceId, { configPaths: paths });
      } catch {
        // Reference-only panel; leave it hidden.
      }
    },
  };
}
