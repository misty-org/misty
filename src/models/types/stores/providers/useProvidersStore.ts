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
  CloudConfigPaths,
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

import type {
  ProviderConnectionSession,
  ProvidersWorkspaceState,
  CachedRemoteDraft,
  ProvidersStore,
} from "@/models/interfaces/stores/providers/useProvidersStore";

export type ProvidersSet = (
  partial: Partial<ProvidersStore> | ((state: ProvidersStore) => Partial<ProvidersStore>),
) => void;
