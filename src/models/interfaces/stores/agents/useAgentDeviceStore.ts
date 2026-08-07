import { managedAiRequest, ManagedAiRequestError } from "@/stores/agent/useAiServerStore";
import type { AgentDevice } from "@/models/interfaces/features/agents/types";
import { invoke } from "@tauri-apps/api/core";

export interface ServerTrustedDevice {
  id: string;
  name: string;
  publicKey?: string;
  revokedAt?: string | null;
}

export interface ServerDeviceList {
  devices: ServerTrustedDevice[];
}

export interface StoredDeviceIdentity {
  publicKey: string;
  privateKey: string;
}
