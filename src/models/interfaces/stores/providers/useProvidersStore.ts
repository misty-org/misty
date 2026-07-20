import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  providersConfigureRemote,
  providersConfigPaths,
  providersDisconnectRemote,
  providersRefresh,
  providersSaveRemote,
  providersSelectRemote,
  providersSnapshot,
  providersTestRemote,
} from "@/stores/backend";
import { accountFetchMe } from "@/stores/account/useAccountStore";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";
import type { ProviderConfigMode } from "@/models/types/services/misty-api";
import type {
  ProviderConfigStep,
  ProviderRemote,
  ProviderWorkflow,
  ProvidersSnapshot,
  RcloneConfigPaths,
  RemoteEditDraft,
} from "@/models/interfaces/services/misty-api";
import type { CurrentLicense } from "@/models/types/features/installer/types";
import { errorText } from "@/lib/format";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { hasTauriInternals } from "@/platform/tauri";
import { useSetupStore } from "@/stores/app";
import { openProviderAuthorizationLink } from "@/platform/openExternalLink";
import type { ProviderAuthorizationOpenResult } from "@/models/interfaces/platform/openExternalLink";
import {
  configPriority,
  isOneDriveProviderType,
  providerOptionsForConnection,
  stableConfig,
  updateTokenField,
} from "@/pages/Providers/providerUtils";

import type { ProvidersSet } from "@/models/types/stores/providers/useProvidersStore";

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
  authorizeOpenAttempts: number;
  authorizeOpenResult: ProviderAuthorizationOpenResult | null;
  authorizeOpenError: string | null;
  authPollAttempts: number;
  authDeadlineMs: number | null;
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

export interface CachedRemoteDraft {
  draft: RemoteEditDraft;
  revision: number;
}

export interface ProvidersStore {
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
  selectRemoteInWorkspace: (
    workspaceId: string,
    name: string,
    guardDirty?: boolean,
    forceReload?: boolean,
  ) => Promise<void>;
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
