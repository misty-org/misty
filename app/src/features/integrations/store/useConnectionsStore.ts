import { connectionsApi, type AccountConnection } from "@/api/connections";
import { create } from "zustand";
import type { IntegrationCapability } from "../types";

interface ConnectionsStore {
  accountId: string;
  connections: AccountConnection[];
  loading: boolean;
  loaded: boolean;
  authorizingProvider: string | null;
  removingConnectionId: string | null;
  error: string | null;
  setAccount: (accountId: string) => void;
  load: (options?: { force?: boolean }) => Promise<void>;
  beginAuthorization: (
    provider: string,
    capabilities: IntegrationCapability[],
    returnTo?: string,
  ) => Promise<string>;
  remove: (connectionId: string) => Promise<void>;
  clearError: () => void;
}

let accountGeneration = 0;

const initialState = {
  accountId: "",
  connections: [] as AccountConnection[],
  loading: false,
  loaded: false,
  authorizingProvider: null as string | null,
  removingConnectionId: null as string | null,
  error: null as string | null,
};

export const useConnectionsStore = create<ConnectionsStore>((set, get) => ({
  ...initialState,
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    accountGeneration += 1;
    set({ ...initialState, accountId });
  },
  load: async (options) => {
    const state = get();
    if (!state.accountId || state.loading || (state.loaded && !options?.force)) return;
    const generation = accountGeneration;
    const accountId = state.accountId;
    set({ loading: true, error: null });
    try {
      const result = await connectionsApi.list();
      if (generation !== accountGeneration || get().accountId !== accountId) return;
      set({ connections: result.connections, loading: false, loaded: true });
    } catch (error) {
      if (generation !== accountGeneration || get().accountId !== accountId) return;
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : "Misty could not load connections.",
      });
    }
  },
  beginAuthorization: async (provider, capabilities, returnTo = "/inbox") => {
    const generation = accountGeneration;
    const accountId = get().accountId;
    if (!accountId) throw new Error("Sign in before connecting an email account.");
    set({ authorizingProvider: provider, error: null });
    try {
      const result = await connectionsApi.authorize(provider, capabilities, returnTo);
      if (generation !== accountGeneration || get().accountId !== accountId) {
        throw new Error("The active account changed while the connection was starting.");
      }
      return result.authorization_url;
    } catch (error) {
      if (generation === accountGeneration && get().accountId === accountId) {
        set({
          error: error instanceof Error ? error.message : "Misty could not start this connection.",
        });
      }
      throw error;
    } finally {
      if (generation === accountGeneration && get().accountId === accountId) {
        set({ authorizingProvider: null });
      }
    }
  },
  remove: async (connectionId) => {
    const generation = accountGeneration;
    const accountId = get().accountId;
    set({ removingConnectionId: connectionId, error: null });
    try {
      await connectionsApi.remove(connectionId);
      if (generation !== accountGeneration || get().accountId !== accountId) return;
      set((state) => ({
        connections: state.connections.filter((connection) => connection.id !== connectionId),
      }));
    } catch (error) {
      if (generation === accountGeneration && get().accountId === accountId) {
        set({
          error: error instanceof Error ? error.message : "Misty could not remove this connection.",
        });
      }
      throw error;
    } finally {
      if (generation === accountGeneration && get().accountId === accountId) {
        set({ removingConnectionId: null });
      }
    }
  },
  clearError: () => set({ error: null }),
}));

export function resetConnectionsAccountState(): void {
  accountGeneration += 1;
  useConnectionsStore.setState(initialState);
}
