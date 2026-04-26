import { agentsDeviceSnapshot, agentsPrepareScopedDocument } from "@/stores/agents/useAgentsStore";
import {
  ensureServerAgentDevice,
  heartbeatServerAgentDevice,
  signedAgentDeviceRequest,
} from "@/stores/agents/useAgentDeviceStore";
import { mistyDeviceJobsEnabled } from "@/features/agents/flags";
import type { AgentDevice } from "@/models/interfaces/features/agents/types";

export interface ClaimedWorkflowNodeJob {
  job: {
    id: string;
    runId: string;
    nodeId: string;
    scopeId: string;
    operation: string;
    attempt: number;
    input: unknown;
    config: unknown;
  };
  leaseToken: string;
  leaseExpiresAt?: string | null;
}
