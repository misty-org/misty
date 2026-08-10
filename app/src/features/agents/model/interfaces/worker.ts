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
