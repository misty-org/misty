import type {
  AgentCitation,
  AgentScope,
  AgentDevice,
  AgentDeviceSnapshot,
  PreparedDocumentSection,
  PreparedAgentDocument,
} from "@/models/interfaces/features/agents/types";

export type AgentCitationKind = "pdf_page" | "slide" | "sheet_range" | "section" | "image";
