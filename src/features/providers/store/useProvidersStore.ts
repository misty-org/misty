import { create } from "zustand";
import type { ProvidersStore } from "../model/stores/providers/interfaces/useProvidersStore";
import { createProviderConnectionActions } from "./createProviderConnectionActions";
import { createProviderWorkspaceActions } from "./createProviderWorkspaceActions";

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: null,
  workspaces: {},
  remoteDraftCache: {},
  remoteRevisions: {},
  loading: true,
  working: false,
  error: null,
  message: null,
  connection: null,
  disconnectTarget: null,
  ...createProviderWorkspaceActions(set, get),
  ...createProviderConnectionActions(set, get),
}));

export * from "./providerWorkspaceState";
