export interface AgentScope {
  id: string;
  deviceId: string;
  displayName: string;
  kind: "local_folder";
  relativePath?: string | null;
  available: boolean;
}

export interface AgentDevice {
  id: string;
  displayName: string;
  status: "online" | "offline" | "revoked";
  capabilities: string[];
  lastSeenAt?: string | null;
}

export interface AgentDeviceSnapshot {
  version: 2;
  device: AgentDevice | null;
  scopes: AgentScope[];
  loadedAt: string;
}

export interface PreparedDocumentSection {
  kind: "page" | "slide" | "sheet" | "section" | "lines";
  locator: string;
  text: string;
}

export interface PreparedAgentDocument {
  documentId: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  sections: PreparedDocumentSection[];
  truncated: boolean;
}
