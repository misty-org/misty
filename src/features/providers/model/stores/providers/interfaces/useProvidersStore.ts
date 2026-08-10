import type {
  CloudConfigPaths,
  ProviderConfigStep,
  ProviderRemote,
  ProvidersSnapshot,
  RemoteEditDraft,
} from "@/native/contracts";
import type { ProviderConfigMode } from "@/native/contracts/primitives";
import type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";

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
  configPaths: CloudConfigPaths | null;
  tokenVisible: boolean;
  loadingRemoteName: string | null;
  loadedRemoteRevision: number;
  error: string | null;
  message: string | null;
}

export interface CachedRemoteDraft {
  draft: RemoteEditDraft;
  revision: number;
}

export interface ProvidersStore {
  providers: ProvidersSnapshot | null;
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
  selectRemoteInWorkspace: (
    workspaceId: string,
    name: string,
    guardDirty?: boolean,
    forceReload?: boolean,
  ) => Promise<void>;
  setWorkspaceDraftName: (workspaceId: string, name: string) => void;
  setWorkspaceConfigField: (workspaceId: string, key: string, value: string) => void;
  setWorkspaceTokenField: (workspaceId: string, key: string, value: string) => void;
  setWorkspaceTokenVisible: (workspaceId: string, visible: boolean) => void;
  saveWorkspaceRemote: (workspaceId: string) => Promise<void>;
  testWorkspaceConnection: (workspaceId: string) => Promise<void>;
  loadWorkspaceConfigPaths: (workspaceId: string) => Promise<void>;
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
