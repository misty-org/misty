import type { ComponentType, ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { createPort } from "@/shared/lib/seams";

export interface AgentCallsHost {
  start(input: {
    agent: AgentProfile;
    conversationId: string;
    video: boolean;
    sees: boolean;
  }): void;
  useBusy(): boolean;
  useTranscript(conversationId?: string): { inCall: boolean; shown: boolean; toggle(): void };
  Split: ComponentType<{ conversationId?: string; children: ReactNode }>;
}

export const agentCallsHost = createPort<AgentCallsHost>("calls with an agent");
