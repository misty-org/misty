import { create } from "zustand";
import {
  providersConfigureRemote,
  providersConfigPaths,
  providersDisconnectRemote,
  providersRefresh,
  providersSaveRemote,
  providersSelectRemote,
  providersSnapshot,
  providersTestRemote,
} from "../../api/misty";
import type {
  ProviderConfigMode,
  ProviderConfigStep,
  ProviderRemote,
  ProviderWorkflow,
  ProvidersSnapshot,
  RcloneConfigPaths,
  RemoteEditDraft,
} from "../../api/types";
import { errorText } from "../../shared/format";
import { openProviderAuthorizationLink } from "../../shared/openExternalLink";
import {
  configPriority,
  providerOptionsForConnection,
  shouldBootstrapOneDriveRepairContinue,
  shouldContinueExistingOneDriveRepair,
  stableConfig,
  updateTokenField,
} from "./providerUtils";

const MAX_PROVIDER_AUTH_POLL_ATTEMPTS = 90;

export interface ProviderConnectionSession {
  mode: ProviderConfigMode;
  stage: "provider" | "configure" | "authorize" | "complete";
  providerType: string;
  remoteName: string;
  parameters: Record<string, string>;
  step: ProviderConfigStep | null;
  inFlight: boolean;
  polling: boolean;
  openedAuthorizeUrl: string | null;
  authPollAttempts: number;
  error: string | null;
}

export interface ProvidersWorkspaceState {
  draft: RemoteEditDraft | null;
  originalDraft: RemoteEditDraft | null;
  configPaths: RcloneConfigPaths | null;
  tokenVisible: boolean;
  loadingRemoteName: string | null;
  loadedRemoteRevision: number;
}

interface CachedRemoteDraft {
  draft: RemoteEditDraft;
  revision: number;
}

interface ProvidersStore {
  providers: ProvidersSnapshot | null;
  draft: RemoteEditDraft | null;
  originalDraft: RemoteEditDraft | null;
  configPaths: RcloneConfigPaths | null;
  tokenVisible: boolean;
  workspaces: Record<string, ProvidersWorkspaceState>;
  remoteDraftCache: Record<string, CachedRemoteDraft>;
  remoteRevisions: Record<string, number>;
  loading: boolean;
  working: boolean;
  error: string | null;
  message: string | null;
  connection: ProviderConnectionSession | null;
  disconnectTarget: string | null;
  ensureWorkspace: (workspaceId: string) => void;
  discardWorkspaces: (workspaceIds: string[]) => void;
  reloadWorkspaceRemote: (workspaceId: string) => Promise<void>;
  load: (refresh?: boolean) => Promise<void>;
  selectRemote: (name: string, guardDirty?: boolean) => Promise<void>;
  selectRemoteInWorkspace: (workspaceId: string, name: string, guardDirty?: boolean, forceReload?: boolean) => Promise<void>;
  setDraftName: (name: string) => void;
  setWorkspaceDraftName: (workspaceId: string, name: string) => void;
  setConfigField: (key: string, value: string) => void;
  setWorkspaceConfigField: (workspaceId: string, key: string, value: string) => void;
  setTokenField: (key: string, value: string) => void;
  setWorkspaceTokenField: (workspaceId: string, key: string, value: string) => void;
  setTokenVisible: (visible: boolean) => void;
  setWorkspaceTokenVisible: (workspaceId: string, visible: boolean) => void;
  saveRemote: () => Promise<void>;
  saveWorkspaceRemote: (workspaceId: string) => Promise<void>;
  testConnection: () => Promise<void>;
  testWorkspaceConnection: (workspaceId: string) => Promise<void>;
  revealConfig: () => Promise<void>;
  revealWorkspaceConfig: (workspaceId: string) => Promise<void>;
  openAddRemote: () => Promise<void>;
  openReconnectRemote: (remote: ProviderRemote) => Promise<void>;
  openRepairRemote: (remote: ProviderRemote) => Promise<void>;
  closeConnection: () => void;
  chooseConnectionProvider: (providerType: string) => void;
  setConnectionName: (name: string) => void;
  setConnectionParameter: (key: string, value: string) => void;
  advanceConnection: () => void;
  submitConnection: (polling?: boolean) => Promise<void>;
  reopenConnectionAuthorization: () => Promise<void>;
  requestDisconnect: (name: string) => void;
  cancelDisconnect: () => void;
  confirmDisconnect: () => Promise<void>;
}

type ProvidersSet = (
  partial: Partial<ProvidersStore> | ((state: ProvidersStore) => Partial<ProvidersStore>),
) => void;

let connectionGeneration = 0;
let providersLoadPromise: Promise<void> | null = null;

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: null,
  draft: null,
  originalDraft: null,
  configPaths: null,
  tokenVisible: false,
  workspaces: {},
  remoteDraftCache: {},
  remoteRevisions: {},
  loading: true,
  working: false,
  error: null,
  message: null,
  connection: null,
  disconnectTarget: null,

  ensureWorkspace: (workspaceId) => {
    set((state) => state.workspaces[workspaceId] ? state : {
      workspaces: {
        ...state.workspaces,
        [workspaceId]: createProvidersWorkspaceState(),
      },
    });
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
        const next = refresh ? await providersRefresh() : await providersSnapshot();
        const remoteRevisions = refresh
          ? bumpRemoteRevisions(get().remoteRevisions, next.remotes.map((remote) => remote.name))
          : get().remoteRevisions;
        set({
          providers: next,
          remoteRevisions,
          remoteDraftCache: refresh
            ? pruneRemoteDraftCacheToRemotes(get().remoteDraftCache, next.remotes)
            : get().remoteDraftCache,
        });
        if (!get().draft && next.remotes.length > 0) {
          await get().selectRemote(next.remotes[0].name, false);
        }
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        providersLoadPromise = null;
        set({ loading: false });
      }
    })();
    return providersLoadPromise;
  },

  selectRemote: async (name, guardDirty = true) => {
    if (guardDirty && isDirty(get()) && !window.confirm("Discard unsaved remote edits?")) {
      return;
    }
    set({ error: null, message: null, tokenVisible: false });
    try {
      const nextDraft = await providersSelectRemote(name);
      set({ draft: nextDraft, originalDraft: nextDraft });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  selectRemoteInWorkspace: async (workspaceId, name, guardDirty = true, forceReload = false) => {
    get().ensureWorkspace(workspaceId);
    const workspace = get().workspaces[workspaceId] ?? createProvidersWorkspaceState();
    if (guardDirty && isWorkspaceDirty(workspace) && !window.confirm("Discard unsaved remote edits?")) {
      return;
    }
    const revision = revisionForRemote(get().remoteRevisions, name);
    const cached = get().remoteDraftCache[name];
    if (!forceReload && cached && cached.revision === revision) {
      set({ error: null, message: null });
      setWorkspaceState(set, workspaceId, {
        draft: cached.draft,
        originalDraft: cached.draft,
        tokenVisible: false,
        loadingRemoteName: null,
        loadedRemoteRevision: cached.revision,
      });
      return;
    }
    set({ error: null, message: null });
    setWorkspaceState(set, workspaceId, {
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
      set({ error: errorText(error) });
    }
  },

  setDraftName: (name) => {
    const { draft } = get();
    if (!draft) return;
    set({ draft: { ...draft, name } });
  },

  setWorkspaceDraftName: (workspaceId, name) => {
    const workspace = get().workspaces[workspaceId];
    if (!workspace?.draft) return;
    setWorkspaceState(set, workspaceId, { draft: { ...workspace.draft, name } });
  },

  setConfigField: (key, value) => {
    const { draft } = get();
    if (!draft || key === "type") return;
    set({ draft: { ...draft, config: { ...draft.config, [key]: value } } });
  },

  setWorkspaceConfigField: (workspaceId, key, value) => {
    const workspace = get().workspaces[workspaceId];
    if (!workspace?.draft || key === "type") return;
    setWorkspaceState(set, workspaceId, {
      draft: { ...workspace.draft, config: { ...workspace.draft.config, [key]: value } },
    });
  },

  setTokenField: (key, value) => {
    const { draft } = get();
    if (!draft) return;
    get().setConfigField("token", updateTokenField(draft.config.token ?? "", key, value));
  },

  setWorkspaceTokenField: (workspaceId, key, value) => {
    const workspace = get().workspaces[workspaceId];
    if (!workspace?.draft) return;
    get().setWorkspaceConfigField(workspaceId, "token", updateTokenField(workspace.draft.config.token ?? "", key, value));
  },

  setTokenVisible: (tokenVisible) => set({ tokenVisible }),
  setWorkspaceTokenVisible: (workspaceId, tokenVisible) => setWorkspaceState(set, workspaceId, { tokenVisible }),

  saveRemote: async () => {
    const { draft, originalDraft } = get();
    if (!draft || !originalDraft || !isValidRemoteName(draft)) return;
    set({ working: true, error: null, message: null });
    try {
      const saved = await providersSaveRemote({
        originalName: originalDraft.originalName,
        name: draft.name,
        parameters: draft.config,
      });
      const remoteRevisions = bumpRemoteRevisions(get().remoteRevisions, [
        originalDraft.originalName,
        saved.originalName,
      ]);
      set({
        draft: saved,
        originalDraft: saved,
        providers: await providersRefresh(),
        remoteDraftCache: {
          ...removeRemoteDraftCache(get().remoteDraftCache, originalDraft.originalName),
          [saved.originalName]: {
            draft: saved,
            revision: revisionForRemote(remoteRevisions, saved.originalName),
          },
        },
        remoteRevisions,
        message: "Remote saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  saveWorkspaceRemote: async (workspaceId) => {
    const workspace = get().workspaces[workspaceId];
    if (!workspace?.draft || !workspace.originalDraft || !isValidRemoteName(workspace.draft)) return;
    if (isProviderWorkspaceStale(workspace, get().remoteRevisions, get().providers?.remotes ?? [])) {
      set({ error: "This remote changed in another pane. Reload it before saving." });
      return;
    }
    set({ working: true, error: null, message: null });
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
        message: "Remote saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  testConnection: async () => {
    const { draft } = get();
    if (!draft) return;
    set({ working: true, error: null, message: null });
    try {
      const result = await providersTestRemote(draft.name);
      set({
        message: result.message,
        draft: result.aboutJson ? { ...draft, aboutJson: result.aboutJson, lastCheckedUnix: result.checkedUnix } : draft,
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  testWorkspaceConnection: async (workspaceId) => {
    const workspace = get().workspaces[workspaceId];
    const draft = workspace?.draft;
    if (!draft) return;
    set({ working: true, error: null, message: null });
    try {
      const result = await providersTestRemote(draft.name);
      set({
        message: result.message,
      });
      if (result.aboutJson) {
        const nextDraft = { ...draft, aboutJson: result.aboutJson, lastCheckedUnix: result.checkedUnix };
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
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  revealConfig: async () => {
    set({ working: true, error: null, message: null });
    try {
      const paths = await providersConfigPaths();
      set({
        configPaths: paths,
        message: paths.configPath ? `Config path: ${paths.configPath}` : "Config paths loaded.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  revealWorkspaceConfig: async (workspaceId) => {
    set({ working: true, error: null, message: null });
    try {
      const paths = await providersConfigPaths();
      setWorkspaceState(set, workspaceId, { configPaths: paths });
      set({
        message: paths.configPath ? `Config path: ${paths.configPath}` : "Config paths loaded.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  openAddRemote: async () => {
    connectionGeneration += 1;
    const generation = connectionGeneration;
    if (!get().providers) {
      set({ working: true, error: null, message: null });
      try {
        await get().load();
      } finally {
        if (generation === connectionGeneration) {
          set({ working: false });
        }
      }
      if (generation !== connectionGeneration || !get().providers) return;
    }
    set({
      connection: createConnectionSession("add"),
      error: null,
      message: null,
    });
  },

  openReconnectRemote: async (remote) => {
    connectionGeneration += 1;
    const generation = connectionGeneration;
    if (!get().providers) {
      set({ working: true, error: null, message: null });
      try {
        await get().load();
      } finally {
        if (generation === connectionGeneration) {
          set({ working: false });
        }
      }
      if (generation !== connectionGeneration || !get().providers) return;
    }
    const connection = createConnectionSession("reconnect", remote);
    connection.parameters = defaultParameters(workflowForType(get().providers?.workflows ?? [], remote.type));
    set({
      connection,
      error: null,
      message: null,
    });
  },

  openRepairRemote: async (remote) => {
    connectionGeneration += 1;
    const generation = connectionGeneration;
    if (!get().providers) {
      set({ working: true, error: null, message: null });
      try {
        await get().load();
      } finally {
        if (generation === connectionGeneration) {
          set({ working: false });
        }
      }
      if (generation !== connectionGeneration || !get().providers) return;
    }
    const connection = createConnectionSession("repair", remote);
    connection.parameters = defaultParametersForSession(
      connection,
      workflowForType(get().providers?.workflows ?? [], remote.type),
    );
    set({
      connection,
      error: null,
      message: null,
    });
  },

  closeConnection: () => {
    connectionGeneration += 1;
    set({ connection: null });
  },

  chooseConnectionProvider: (providerType) => set((state) => {
    if (!state.connection) return state;
    const workflow = workflowForType(state.providers?.workflows ?? [], providerType);
    const connection = {
      ...state.connection,
      providerType,
      remoteName: state.connection.remoteName || providerType,
      parameters: {},
      error: null,
    };
    return {
      connection: {
        ...connection,
        parameters: defaultParametersForSession(connection, workflow),
      },
    };
  }),

  setConnectionName: (remoteName) => set((state) => state.connection ? {
    connection: { ...state.connection, remoteName, error: null },
  } : state),

  setConnectionParameter: (key, value) => set((state) => state.connection ? {
    connection: {
      ...state.connection,
      parameters: { ...state.connection.parameters, [key]: value },
      error: null,
    },
  } : state),

  advanceConnection: () => set((state) => {
    const session = state.connection;
    if (!session || !session.providerType) return state;
    return { connection: { ...session, stage: "configure", error: null } };
  }),

  submitConnection: async (polling = false) => {
    const session = get().connection;
    if (!session || session.inFlight) return;
    const validationError = validateConnectionSession(session, get().providers?.workflows ?? []);
    const duplicateName = session.mode === "add"
      && get().providers?.remotes.some((remote) => remote.name === session.remoteName.trim());
    if ((validationError || duplicateName) && !polling) {
      set({
        connection: {
          ...session,
          error: duplicateName ? "A remote with that name already exists." : validationError,
        },
      });
      return;
    }
    const generation = connectionGeneration;
    set({
      connection: {
        ...session,
        inFlight: true,
        polling,
        error: null,
      },
    });
    try {
      const pollingBrowserAuth = polling && session.step?.kind === "browser_auth";
      const bootstrapExistingConfigContinue = shouldBootstrapOneDriveRepairContinue(session);
      const continueExistingOneDriveRepair = shouldContinueExistingOneDriveRepair(session);
      const step = await providersConfigureRemote({
        name: session.remoteName.trim(),
        providerType: session.providerType,
        parameters: pollingBrowserAuth ? {} : session.parameters,
        state: session.step?.state ?? "",
        result: session.step?.result ?? "",
        mode: session.mode,
        continuing: bootstrapExistingConfigContinue || session.step != null,
        continueExisting: continueExistingOneDriveRepair,
      });
      if (generation !== connectionGeneration || !get().connection) return;

      const current = get().connection!;
      const parameters = { ...current.parameters };
      if (step.option && !parameters[step.option.name]) {
        parameters[step.option.name] = step.option.defaultValue || step.option.choices[0]?.value || "";
      }
      const complete = step.done || step.kind === "done";
      const authorize = step.kind === "browser_auth" || Boolean(step.authorizeUrl);
      const configuringProvider = Boolean(step.option?.name);
      const authPollAttempts = authorize && polling ? current.authPollAttempts + 1 : 0;
      const authPollingTimedOut = authorize
        && polling
        && authPollAttempts >= MAX_PROVIDER_AUTH_POLL_ATTEMPTS;
      const next: ProviderConnectionSession = {
        ...current,
        stage: complete ? "complete" : configuringProvider ? "configure" : authorize ? "authorize" : "configure",
        parameters,
        step,
        inFlight: false,
        polling: authorize && !complete && !configuringProvider && !authPollingTimedOut,
        authPollAttempts,
        error: authPollingTimedOut ? providerAuthorizationTimedOutMessage() : null,
      };

      const shouldOpenAuthorizeUrl = Boolean(step.authorizeUrl)
        && (!pollingBrowserAuth || !current.openedAuthorizeUrl)
        && step.authorizeUrl !== current.openedAuthorizeUrl;
      if (shouldOpenAuthorizeUrl) {
        try {
          await openProviderAuthorizationLink(step.authorizeUrl);
          next.openedAuthorizeUrl = step.authorizeUrl;
        } catch (error) {
          next.error = `Could not open browser sign-in: ${errorText(error)}`;
        }
      }
      set({ connection: next });

      if (complete) {
        const providers = await providersRefresh();
        if (generation !== connectionGeneration) return;
        const remoteRevisions = bumpRemoteRevisions(get().remoteRevisions, [next.remoteName]);
        set({
          providers,
          remoteDraftCache: removeRemoteDraftCache(get().remoteDraftCache, next.remoteName),
          remoteRevisions,
          message: `Remote “${next.remoteName}” ${providerFlowSuccessSuffix(next.mode)}`,
        });
        return;
      }
      if (next.polling) {
        window.setTimeout(() => {
          if (generation === connectionGeneration && get().connection?.stage === "authorize") {
            void get().submitConnection(true);
          }
        }, Math.max(500, step.pollAfterMs || 1000));
      }
    } catch (error) {
      if (generation !== connectionGeneration) return;
      set((state) => state.connection ? {
        connection: nextConnectionAfterProviderError(state.connection, error, polling),
      } : state);
      const current = get().connection;
      if (polling && current?.polling) {
        window.setTimeout(() => {
          if (generation === connectionGeneration && get().connection?.stage === "authorize") {
            void get().submitConnection(true);
          }
        }, Math.max(1500, current.step?.pollAfterMs ?? 1000));
      }
    }
  },

  reopenConnectionAuthorization: async () => {
    const session = get().connection;
    const authorizeUrl = session?.step?.authorizeUrl;
    if (!session || !authorizeUrl) {
      set((state) => state.connection ? {
        connection: {
          ...state.connection,
          error: "This provider flow did not return a browser URL to reopen.",
        },
      } : state);
      return;
    }
    try {
      await openProviderAuthorizationLink(authorizeUrl);
      const current = get().connection;
      if (!current || current.step?.authorizeUrl !== authorizeUrl) return;
      set({
        connection: {
          ...current,
          openedAuthorizeUrl: authorizeUrl,
          error: null,
        },
      });
    } catch (error) {
      const current = get().connection;
      if (!current || current.step?.authorizeUrl !== authorizeUrl) return;
      set({
        connection: {
          ...current,
          error: `Could not open browser sign-in: ${errorText(error)}`,
        },
      });
    }
  },

  requestDisconnect: (disconnectTarget) => set({ disconnectTarget }),
  cancelDisconnect: () => set({ disconnectTarget: null }),
  confirmDisconnect: async () => {
    const name = get().disconnectTarget;
    if (!name) return;
    set({ working: true, error: null, message: null });
    try {
      const providers = await providersDisconnectRemote(name);
      set({
        providers,
        remoteRevisions: bumpRemoteRevisions(get().remoteRevisions, [name]),
        draft: get().draft?.originalName === name ? null : get().draft,
        originalDraft: get().originalDraft?.originalName === name ? null : get().originalDraft,
        remoteDraftCache: removeRemoteDraftCache(get().remoteDraftCache, name),
        workspaces: pruneRemoteFromWorkspaces(get().workspaces, name),
        disconnectTarget: null,
        message: `Remote “${name}” disconnected.`,
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

export function selectProviderDerived(state: ProvidersStore) {
  return {
    dirty: isDirty(state),
    validRemoteName: state.draft ? isValidRemoteName(state.draft) : false,
    configKeys: state.draft
      ? Object.keys(state.draft.config)
          .filter((key) => key !== "type")
          .sort((left, right) => configPriority(left) - configPriority(right) || left.localeCompare(right))
      : [],
    status: state.providers
      ? state.providers.health.ready
        ? `Ready${state.providers.health.version ? ` · ${state.providers.health.version}` : ""}`
        : state.providers.health.error || state.providers.error || "Provider service unavailable"
      : "Starting",
  };
}

export function selectProviderWorkspaceDerived(workspace: ProvidersWorkspaceState) {
  return {
    dirty: isWorkspaceDirty(workspace),
    validRemoteName: workspace.draft ? isValidRemoteName(workspace.draft) : false,
    configKeys: workspace.draft
      ? Object.keys(workspace.draft.config)
          .filter((key) => key !== "type")
          .sort((left, right) => configPriority(left) - configPriority(right) || left.localeCompare(right))
      : [],
  };
}

export function createProvidersWorkspaceState(): ProvidersWorkspaceState {
  return {
    draft: null,
    originalDraft: null,
    configPaths: null,
    tokenVisible: false,
    loadingRemoteName: null,
    loadedRemoteRevision: 0,
  };
}

export function isProviderWorkspaceStale(
  workspace: ProvidersWorkspaceState,
  remoteRevisions: Record<string, number>,
  remotes: ProviderRemote[],
): boolean {
  const remoteName = workspace.draft?.originalName;
  if (!remoteName) return false;
  if (!remotes.some((remote) => remote.name === remoteName)) return true;
  return workspace.loadedRemoteRevision < revisionForRemote(remoteRevisions, remoteName);
}

function isDirty(state: Pick<ProvidersStore, "draft" | "originalDraft">): boolean {
  if (!state.draft || !state.originalDraft) return false;
  return (
    state.draft.name !== state.originalDraft.name ||
    stableConfig(state.draft.config) !== stableConfig(state.originalDraft.config)
  );
}

function isWorkspaceDirty(state: Pick<ProvidersWorkspaceState, "draft" | "originalDraft">): boolean {
  if (!state.draft || !state.originalDraft) return false;
  return (
    state.draft.name !== state.originalDraft.name ||
    stableConfig(state.draft.config) !== stableConfig(state.originalDraft.config)
  );
}

function setWorkspaceState(
  set: ProvidersSet,
  workspaceId: string,
  patch: Partial<ProvidersWorkspaceState>,
): void {
  set((state) => {
    const current = state.workspaces[workspaceId] ?? createProvidersWorkspaceState();
    return {
      workspaces: {
        ...state.workspaces,
        [workspaceId]: { ...current, ...patch },
      },
    };
  });
}

function pruneRemoteFromWorkspaces(
  workspaces: Record<string, ProvidersWorkspaceState>,
  name: string,
): Record<string, ProvidersWorkspaceState> {
  let changed = false;
  const next: Record<string, ProvidersWorkspaceState> = {};
  for (const [workspaceId, workspace] of Object.entries(workspaces)) {
    if (workspace.draft?.originalName === name || workspace.originalDraft?.originalName === name) {
      next[workspaceId] = { ...workspace, draft: null, originalDraft: null };
      changed = true;
    } else {
      next[workspaceId] = workspace;
    }
  }
  return changed ? next : workspaces;
}

function removeRemoteDraftCache(
  cache: Record<string, CachedRemoteDraft>,
  name: string,
): Record<string, CachedRemoteDraft> {
  if (!(name in cache)) return cache;
  const next = { ...cache };
  delete next[name];
  return next;
}

function pruneRemoteDraftCacheToRemotes(
  cache: Record<string, CachedRemoteDraft>,
  remotes: ProviderRemote[],
): Record<string, CachedRemoteDraft> {
  const remoteNames = new Set(remotes.map((remote) => remote.name));
  let changed = false;
  const next: Record<string, CachedRemoteDraft> = {};
  for (const [name, cached] of Object.entries(cache)) {
    if (remoteNames.has(name)) {
      next[name] = cached;
    } else {
      changed = true;
    }
  }
  return changed ? next : cache;
}

function revisionForRemote(remoteRevisions: Record<string, number>, name: string): number {
  return remoteRevisions[name] ?? 0;
}

function bumpRemoteRevisions(
  remoteRevisions: Record<string, number>,
  names: string[],
): Record<string, number> {
  const next = { ...remoteRevisions };
  for (const name of new Set(names.map((value) => value.trim()).filter(Boolean))) {
    next[name] = revisionForRemote(next, name) + 1;
  }
  return next;
}

function isValidRemoteName(draft: RemoteEditDraft): boolean {
  const trimmed = draft.name.trim();
  return trimmed.length > 0 && !trimmed.includes(":") && !trimmed.includes("/") && !trimmed.includes("\\");
}

function createConnectionSession(mode: ProviderConfigMode, remote?: ProviderRemote): ProviderConnectionSession {
  return {
    mode,
    stage: mode === "add" ? "provider" : "configure",
    providerType: remote?.type ?? "",
    remoteName: remote?.name ?? "",
    parameters: {},
    step: null,
    inFlight: false,
    polling: false,
    openedAuthorizeUrl: null,
    authPollAttempts: 0,
    error: null,
  };
}

function providerConnectionErrorText(error: unknown, polling: boolean): string {
  const message = errorText(error);
  if (!polling) return message;
  if (isRecoverableAuthPollingError(error)) {
    return "Still waiting for provider authorization. Complete the browser sign-in, then return to Misty.";
  }
  return message;
}

function nextConnectionAfterProviderError(
  connection: ProviderConnectionSession,
  error: unknown,
  polling: boolean,
): ProviderConnectionSession {
  const authPollAttempts = polling ? connection.authPollAttempts + 1 : connection.authPollAttempts;
  const recoverablePolling = polling
    && isRecoverableAuthPollingError(error)
    && authPollAttempts < MAX_PROVIDER_AUTH_POLL_ATTEMPTS;
  return {
    ...connection,
    stage: polling && connection.step ? "authorize" : connection.stage,
    inFlight: false,
    polling: recoverablePolling,
    authPollAttempts,
    error: polling && !recoverablePolling && isRecoverableAuthPollingError(error)
      ? providerAuthorizationTimedOutMessage()
      : providerConnectionErrorText(error, polling),
  };
}

function providerAuthorizationTimedOutMessage(): string {
  return "Provider authorization timed out. Reopen the browser sign-in page, complete the flow, then try Connect again.";
}

function providerFlowSuccessSuffix(mode: ProviderConfigMode): string {
  if (mode === "repair") return "configured.";
  if (mode === "reconnect") return "reconnected.";
  return "connected.";
}

function isRecoverableAuthPollingError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return message.includes("authorization")
    || message.includes("oauth")
    || message.includes("token")
    || message.includes("auth header")
    || message.includes("unauthorized")
    || message.includes("forbidden");
}

function workflowForType(workflows: ProviderWorkflow[], providerType: string): ProviderWorkflow | null {
  const normalized = providerType.toLowerCase().replace(/[^a-z0-9]/g, "");
  return workflows.find((workflow) => workflow.type === providerType)
    ?? workflows.find((workflow) => {
      const type = workflow.type.toLowerCase().replace(/[^a-z0-9]/g, "");
      const name = workflow.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return type === normalized || name === normalized || type.includes(normalized) || normalized.includes(type);
    })
    ?? null;
}

function defaultParameters(workflow: ProviderWorkflow | null): Record<string, string> {
  if (!workflow) return {};
  return Object.fromEntries(workflow.options.map((option) => [
    option.name,
    option.defaultValue || option.choices[0]?.value || "",
  ]));
}

function defaultParametersForSession(
  session: ProviderConnectionSession,
  workflow: ProviderWorkflow | null,
): Record<string, string> {
  const options = providerOptionsForConnection(session, workflow);
  return Object.fromEntries(options.map((option) => [
    option.name,
    option.defaultValue || option.choices[0]?.value || "",
  ]));
}

function validateConnectionSession(
  session: ProviderConnectionSession,
  workflows: ProviderWorkflow[],
): string | null {
  if (!session.providerType) return "Choose a provider.";
  const name = session.remoteName.trim();
  if (!name) return "Enter a remote name.";
  if (name.includes(":") || name.includes("/") || name.includes("\\")) {
    return "Remote names cannot contain colons or path separators.";
  }
  const workflow = workflowForType(workflows, session.providerType);
  const options = providerOptionsForConnection(session, workflow);
  const missing = options.find((option) => option.required && !(session.parameters[option.name] ?? "").trim());
  return missing ? `${missing.label || missing.name} is required.` : null;
}
