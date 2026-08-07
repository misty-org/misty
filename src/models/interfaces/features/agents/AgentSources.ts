import { Button } from "@/ui";
import { FileText, Presentation, Sheet, TextQuote } from "lucide-react";
import { agentsOpenCitation } from "@/stores/agents/useAgentsStore";
import type { AgentCitation } from "@/models/interfaces/features/agents/types";

export interface AgentSourcesProps {
  citations: AgentCitation[];
  onOpen?: (citation: AgentCitation) => void | Promise<void>;
  compact?: boolean;
}
