import type { AgentCitation } from "./types";

export interface AgentSourcesProps {
  citations: AgentCitation[];
  onOpen?: (citation: AgentCitation) => void | Promise<void>;
  compact?: boolean;
}
