import type { CollaborationEvent } from "@/features/agents/agentCollaboration";
import type { AppRequest } from "@/features/agents";

import type { ScreenRequest, AiArtifact, AiCitation, MistyUndoReceipt } from "./types";

export type AiInvocationState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_device"
  | "awaiting_intervention"
  | "awaiting_timer"
  | "completed"
  | "failed"
  | "canceled";
/** A run's plan and findings, shown in the conversation as the run works. */
export interface AgentNotebook {
  plan: string;
  findings: string;
  /** The note it is mirrored to in the personal Space. */
  noteId?: string;
}

/** One sub-agent a run started with agent_delegate. */
export interface AgentSubagent {
  invocationId: string;
  goal: string;
  state: string;
  summary?: string;
}

export type AiInvocationEvent =
  | { id: string; type: "user.steering"; text: string }
  | ({ id: string } & CollaborationEvent)
  | {
      id: string;
      type: "steering.received" | "steering.closed";
      messages: Array<{ sequence: number; text: string }>;
      closed: boolean;
    }
  | {
      id: string;
      type: "invocation.started";
      state: AiInvocationState;
    }
  | {
      id: string;
      type: "assistant.status";
      text?: string;
      phase?: string;
      runId?: string;
      summary?: string;
      toolName?: string;
    }
  | {
      id: string;
      type: "response.delta";
      delta: string;
    }
  | {
      id: string;
      type: "assistant.message";
      text: string;
      summary: string;
    }
  | {
      id: string;
      type: "citation";
      citation: AiCitation;
    }
  | {
      id: string;
      type: "app.request";
      appRequest: AppRequest;
    }
  | {
      id: string;
      type: "screen.request";
      screenRequest: ScreenRequest;
    }
  | {
      id: string;
      type: "notebook.updated";
      notebook: AgentNotebook;
    }
  | {
      id: string;
      type: "delegation.updated";
      delegation: { children: AgentSubagent[] };
    }
  | {
      id: string;
      type: "artifact.proposed";
      artifact: AiArtifact;
    }
  | {
      id: string;
      type: "approval.required";
      artifact: AiArtifact;
    }
  | {
      id: string;
      type: "effect.applied";
      artifactId: string;
      summary: string;
    }
  | {
      id: string;
      type: "undo.available";
      receipt: MistyUndoReceipt;
    }
  | {
      id: string;
      type: "run.started";
      runId: string;
    }
  | {
      id: string;
      type: "tool.started" | "tool.completed" | "tool.failed";
      toolCallId: string;
      toolName: string;
      durationMs?: number;
      error?: string;
    }
  | {
      id: string;
      type: "tool.detail";
      toolCallId: string;
      toolName: string;
      activity: AiToolActivity;
    }
  | {
      id: string;
      type: "invocation.completed";
      state: AiInvocationState;
    }
  | {
      id: string;
      type: "invocation.failed";
      state: AiInvocationState;
      error: string;
    }
  | {
      id: string;
      type: "invocation.canceled";
      state: AiInvocationState;
    };
export interface AiTranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations: AiCitation[];
  artifacts: AiArtifact[];
  invocationId?: string;
  taskId?: string;
}

/**
 * What a tool call targeted and got back, summarized by the server from known
 * fields only: a short target, a short result, a few rows, or printed output.
 */
interface AiToolActivity {
  detail?: string;
  result?: string;
  rows?: { title: string; meta?: string }[];
  output?: string;
}

/** One entry of a reply's work, in order: something Misty said while working, or a tool it ran. */
export type AiProgressItem =
  | { type: "note"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      state: "running" | "completed" | "failed";
      activity?: AiToolActivity;
      durationMs?: number;
      /** Why it failed, in plain words. */
      error?: string;
    };
