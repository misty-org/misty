export interface AgentScope {
  id: string;
  deviceId: string;
  displayName: string;
  /** A project is shared with write access: agents edit it and run commands. */
  kind: "local_folder" | "project_folder";
  /** Projects only: commands may install packages through Misty's proxy. */
  allowInstalls?: boolean;
  /** Projects only: agents may push branches, and the default branch. */
  allowPush?: boolean;
  allowPushDefault?: boolean;
  /** Projects only: the folder is a Git repository. */
  git?: boolean;
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
