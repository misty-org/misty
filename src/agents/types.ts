export type AgentCitationKind = "pdf_page" | "slide" | "sheet_range" | "section" | "image";

export interface AgentCitation {
  id: string;
  artifactId?: string | null;
  scopeId: string;
  fileName: string;
  relativePath?: string | null;
  kind: AgentCitationKind;
  label: string;
  page?: number | null;
  slide?: number | null;
  sheet?: string | null;
  range?: string | null;
  section?: string | null;
  excerpt?: string | null;
}

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
