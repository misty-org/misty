import {
  beginCloudAuthorization,
  cloudConnectionsSnapshot,
  cloudConnectionToken,
  deleteCloudConnection,
  type CloudProvider,
} from "@/features/cloud";
import {
  providersDisconnectRemote,
  providersImportCloudConnection,
  providersRefresh,
  providersSelectRemote,
} from "@/native";
import type { ProviderConfigStep } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import type {
  ProviderConnectionSession,
  ProvidersStore,
} from "../model/stores/providers/interfaces/useProvidersStore";

import {
  cancelProviderAuthorization,
  createConnectionSession,
  currentConnectionGeneration,
  defaultParametersForSession,
  defaultProviderOptionValue,
  expireProviderAuthorization,
  isProviderAuthorizationExpired,
  nextConnectionAfterProviderError,
  nextConnectionGeneration,
  nextConnectionParameters,
  normalizeProviderParametersForSession,
  providerAuthorizationPollDelay,
  providerAuthorizationTimedOutMessage,
  providerAuthorizationTimeoutMs,
  providerFlowSuccessSuffix,
  scheduleProviderAuthorizationTimeout,
  validateCanAddRemote,
  validateConnectionSession,
  workflowForType,
  type ProvidersGet,
  type ProvidersSet,
} from "./providerConnectionHelpers";
import {
  bumpRemoteRevisions,
  pruneRemoteFromWorkspaces,
  removeRemoteDraftCache,
} from "./providerWorkspaceState";

export function createProviderConnectionActions(
  set: ProvidersSet,
  get: ProvidersGet,
): Pick<
  ProvidersStore,
  | "openAddRemote"
  | "openRepairRemote"
  | "closeConnection"
  | "chooseConnectionProvider"
  | "setConnectionName"
  | "setConnectionParameter"
  | "advanceConnection"
  | "submitConnection"
  | "reopenConnectionAuthorization"
  | "requestDisconnect"
  | "cancelDisconnect"
  | "confirmDisconnect"
> {
  return {
    openAddRemote: async () => {
      nextConnectionGeneration();
      const generation = currentConnectionGeneration();
      set({ working: true, error: null, message: null });
      if (!get().providers) {
        await get().load();
        if (generation !== currentConnectionGeneration() || !get().providers) {
          if (generation === currentConnectionGeneration()) set({ working: false });
          return;
        }
      }
      let remoteLimitError: string | null = null;
      try {
        remoteLimitError = await validateCanAddRemote(get().providers?.remotes ?? []);
      } catch (error) {
        remoteLimitError = `Could not verify your Misty license before adding a remote. ${errorText(error)}`;
      }
      if (generation !== currentConnectionGeneration()) return;
      if (remoteLimitError) {
        set({ error: remoteLimitError, message: null, working: false });
        return;
      }
      set({
        connection: createConnectionSession("add"),
        error: null,
        message: null,
        working: false,
      });
    },

    openRepairRemote: async (remote) => {
      nextConnectionGeneration();
      const generation = currentConnectionGeneration();
      if (!get().providers) {
        set({ working: true, error: null, message: null });
        try {
          await get().load();
        } finally {
          if (generation === currentConnectionGeneration()) {
            set({ working: false });
          }
        }
        if (generation !== currentConnectionGeneration() || !get().providers) return;
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
      const session = get().connection;
      nextConnectionGeneration();
      set({ connection: null });
      void cancelProviderAuthorization(session);
    },

    chooseConnectionProvider: (providerType) =>
      set((state) => {
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

    setConnectionName: (remoteName) =>
      set((state) =>
        state.connection
          ? {
              connection: { ...state.connection, remoteName, error: null },
            }
          : state,
      ),

    setConnectionParameter: (key, value) =>
      set((state) =>
        state.connection
          ? {
              connection: {
                ...state.connection,
                parameters: nextConnectionParameters(state.connection, key, value),
                error: null,
              },
            }
          : state,
      ),

    advanceConnection: () =>
      set((state) => {
        const session = state.connection;
        if (!session || !session.providerType) return state;
        return { connection: { ...session, stage: "configure", error: null } };
      }),

    submitConnection: async (polling = false) => {
      const session = get().connection;
      if (!session || session.inFlight) return;
      if (session.stage === "authorize" && isProviderAuthorizationExpired(session)) {
        void expireProviderAuthorization(get, set, currentConnectionGeneration());
        return;
      }
      const validationError = validateConnectionSession(session, get().providers?.workflows ?? []);
      const duplicateName =
        session.mode === "add" &&
        get().providers?.remotes.some((remote) => remote.name === session.remoteName.trim());
      if ((validationError || duplicateName) && !polling) {
        set({
          connection: {
            ...session,
            error: duplicateName ? "A remote with that name already exists." : validationError,
          },
        });
        return;
      }
      const generation = currentConnectionGeneration();
      set({
        connection: {
          ...session,
          inFlight: true,
          polling,
          error: null,
        },
      });
      try {
        const normalizedParameters = normalizeProviderParametersForSession(session);
        const remoteName = session.remoteName.trim();
        let step: ProviderConfigStep;
        if (!polling) {
          const authorization = await beginCloudAuthorization({
            provider: session.providerType as CloudProvider,
            name: remoteName,
            clientId: normalizedParameters.client_id,
            clientSecret: normalizedParameters.client_secret,
          });
          step = {
            kind: "browser_auth",
            name: remoteName,
            state: authorization.state_expires_at,
            result: "pending",
            done: false,
            error: "",
            authorizeUrl: authorization.authorization_url,
            instructions: "Complete sign-in in the browser.",
            pollAfterMs: 1_000,
            option: null,
          };
        } else {
          const cloud = await cloudConnectionsSnapshot();
          const connected = cloud.connections.find(
            (candidate) =>
              candidate.provider === session.providerType && candidate.name === remoteName,
          );
          if (!connected) {
            step = {
              kind: "browser_auth",
              name: remoteName,
              state: session.step?.state ?? "",
              result: "pending",
              done: false,
              error: "",
              authorizeUrl: session.step?.authorizeUrl ?? "",
              instructions: "Complete sign-in in the browser.",
              pollAfterMs: 1_000,
              option: null,
            };
          } else {
            const lease = await cloudConnectionToken(connected.id);
            await providersImportCloudConnection({
              name: remoteName,
              providerType: connected.provider,
              connectionId: connected.id,
              accessToken: lease.access_token,
            });
            step = {
              kind: "done",
              name: remoteName,
              state: "",
              result: "done",
              done: true,
              error: "",
              authorizeUrl: "",
              instructions: "",
              pollAfterMs: 0,
              option: null,
            };
          }
        }
        if (generation !== currentConnectionGeneration() || !get().connection) return;

        const current = get().connection!;
        const parameters = normalizeProviderParametersForSession(current);
        if (step.option && !parameters[step.option.name]) {
          parameters[step.option.name] = defaultProviderOptionValue(step.option);
        }
        const complete = step.done || step.kind === "done";
        const authorize = step.kind === "browser_auth" || Boolean(step.authorizeUrl);
        const configuringProvider = Boolean(step.option?.name);
        const authDeadlineMs =
          authorize && !complete && !configuringProvider
            ? (current.authDeadlineMs ?? Date.now() + providerAuthorizationTimeoutMs())
            : null;
        const authPollAttempts = authorize && polling ? current.authPollAttempts + 1 : 0;
        const authPollingTimedOut = authDeadlineMs != null && Date.now() >= authDeadlineMs;
        const next: ProviderConnectionSession = {
          ...current,
          stage: complete
            ? "complete"
            : configuringProvider
              ? "configure"
              : authorize
                ? "authorize"
                : "configure",
          parameters,
          step,
          inFlight: false,
          polling: authorize && !complete && !configuringProvider && !authPollingTimedOut,
          authPollAttempts,
          authDeadlineMs,
          error: authPollingTimedOut ? providerAuthorizationTimedOutMessage() : null,
        };

        const shouldOpenAuthorizeUrl =
          Boolean(step.authorizeUrl) &&
          (!polling || !current.openedAuthorizeUrl) &&
          step.authorizeUrl !== current.openedAuthorizeUrl;
        if (shouldOpenAuthorizeUrl) {
          try {
            const openResult = await openProviderAuthorizationLink(step.authorizeUrl);
            next.openedAuthorizeUrl = step.authorizeUrl;
            next.authorizeOpenAttempts = current.authorizeOpenAttempts + 1;
            next.authorizeOpenResult = openResult;
            next.authorizeOpenError = null;
          } catch (error) {
            const message = errorText(error);
            next.authorizeOpenAttempts = current.authorizeOpenAttempts + 1;
            next.authorizeOpenError = message;
            next.error = `Could not open browser sign-in: ${message}`;
          }
        }
        set({ connection: next });

        if (complete) {
          const providers = await providersRefresh();
          if (generation !== currentConnectionGeneration()) return;
          const remoteRevisions = bumpRemoteRevisions(get().remoteRevisions, [next.remoteName]);
          set({
            providers,
            remoteDraftCache: removeRemoteDraftCache(get().remoteDraftCache, next.remoteName),
            remoteRevisions,
            message: `Remote “${next.remoteName}” ${providerFlowSuccessSuffix(next.mode)}`,
          });
          return;
        }
        if (authPollingTimedOut) {
          void expireProviderAuthorization(get, set, generation);
          return;
        }
        if (next.polling) {
          if (next.authDeadlineMs && next.authDeadlineMs !== current.authDeadlineMs) {
            scheduleProviderAuthorizationTimeout(get, set, generation, next.authDeadlineMs);
          }
          window.setTimeout(() => {
            if (
              generation === currentConnectionGeneration() &&
              get().connection?.stage === "authorize"
            ) {
              void get().submitConnection(true);
            }
          }, providerAuthorizationPollDelay(step.pollAfterMs));
        }
      } catch (error) {
        if (generation !== currentConnectionGeneration()) return;
        set((state) =>
          state.connection
            ? {
                connection: nextConnectionAfterProviderError(state.connection, error, polling),
              }
            : state,
        );
        const current = get().connection;
        if (current?.stage === "authorize" && isProviderAuthorizationExpired(current)) {
          void expireProviderAuthorization(get, set, generation);
          return;
        }
        if (polling && current?.polling) {
          window.setTimeout(() => {
            if (
              generation === currentConnectionGeneration() &&
              get().connection?.stage === "authorize"
            ) {
              void get().submitConnection(true);
            }
          }, providerAuthorizationPollDelay(current.step?.pollAfterMs));
        }
      }
    },

    reopenConnectionAuthorization: async () => {
      const session = get().connection;
      const authorizeUrl = session?.step?.authorizeUrl;
      if (!session || !authorizeUrl) {
        set((state) =>
          state.connection
            ? {
                connection: {
                  ...state.connection,
                  error: "This provider flow did not return a browser URL to reopen.",
                },
              }
            : state,
        );
        return;
      }
      try {
        const openResult = await openProviderAuthorizationLink(authorizeUrl);
        const current = get().connection;
        if (!current || current.step?.authorizeUrl !== authorizeUrl) return;
        set({
          connection: {
            ...current,
            openedAuthorizeUrl: authorizeUrl,
            authorizeOpenAttempts: current.authorizeOpenAttempts + 1,
            authorizeOpenResult: openResult,
            authorizeOpenError: null,
            error: null,
          },
        });
      } catch (error) {
        const current = get().connection;
        if (!current || current.step?.authorizeUrl !== authorizeUrl) return;
        set({
          connection: {
            ...current,
            authorizeOpenAttempts: current.authorizeOpenAttempts + 1,
            authorizeOpenError: errorText(error),
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
        try {
          const draft = await providersSelectRemote(name);
          const connectionId = draft.config.misty_connection_id;
          if (connectionId) await deleteCloudConnection(connectionId);
        } catch {
          // The local connection is still removed when the account session is unavailable.
        }
        const providers = await providersDisconnectRemote(name);
        set({
          providers,
          remoteRevisions: bumpRemoteRevisions(get().remoteRevisions, [name]),
          remoteDraftCache: removeRemoteDraftCache(get().remoteDraftCache, name),
          workspaces: pruneRemoteFromWorkspaces(get().workspaces, name),
          disconnectTarget: null,
          message: `Remote “${name}” deleted.`,
        });
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ working: false });
      }
    },
  };
}
