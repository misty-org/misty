import { createPort } from "@/shared/lib/seams";

/** A workflow as the memory tree shows it. Agents own workflows; Memory only lists and turns them off. */
export interface MemoryWorkflow {
  id: string;
  agent_id: string;
  kind: string;
  enabled: boolean;
  version: number;
  space_id?: string;
  updated_at: string;
  definition: {
    title: string;
    description: string;
    instructions: string;
    inputs: unknown[];
    target: "cloud" | "current_window";
    required_tools: string[];
  };
}

export type MemoryWorkflowDraft = Partial<Pick<MemoryWorkflow, "id" | "space_id" | "version">> &
  Pick<MemoryWorkflow, "agent_id" | "kind" | "enabled" | "definition"> & {
    expected_version?: number;
  };

/** Agents sit above Memory, so they fill this in once at startup. */
export const memoryWorkflows = createPort<{
  accountId(): string;
  list(account: string): Promise<MemoryWorkflow[]>;
  save(account: string, draft: MemoryWorkflowDraft): Promise<{ id: string }>;
}>("workflows for Memory");
