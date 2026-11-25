import type { CollaborationEvent } from "../../plans/agent_collaboration";
import type { AppRequest } from "../../connected-apps/api";

import type { ScreenRequest, AiArtifact, AiCitation, MistyUndoReceipt } from "./invocation_types";

export type AiInvocationState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_intervention"
  | "completed"
  | "failed"
  | "canceled";
export interface AgentNotebook {
  plan: string;
  findings: string;
  noteId?: string;
}

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
      messages: Array<{ sequence: string | number; text: string }>;
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
      type: "conversation.title";
      text: string;
    }
  | {
      id: string;
      type: "local.artifact_answer";
      text: string;
    }
  | {
      id: string;
      type: "conversation.notes";
      data: unknown;
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
      args?: unknown;
      result?: unknown;
      path?: string;
      pictures?: string[];
      parentToolCallId?: string;
    }
  | {
      id: string;
      type: "usage.updated";
      used?: number | null;
      window?: number | null;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      reasoning?: number;
      costUsd?: number;
      model?: string;
    }
  | {
      id: string;
      type: "permission.denied";
      toolCallId?: string;
      toolName?: string;
      path?: string;
      message: string;
    }
  | ({ id: string } & EngineTurnEvent)
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
      durationMs?: number;
      model?: string;
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
export interface EngineQuestionOption {
  label: string;
  description: string;
}

export interface EngineQuestion {
  question: string;
  header: string;
  options: EngineQuestionOption[];
  multiSelect: boolean;
}

export interface EngineTodo {
  id?: string;
  content: string;
  status?: "pending" | "active" | "complete" | "blocked" | "dropped";
}

export interface EnginePlanReview {
  planId: string;
  revision: number;
  engine: string;
  sessionId: string;
  title: string;
  content: string;
  complete: boolean;
  reviewKind: "native_request" | "next_turn";
  status: string;
}

export type EngineTurnEvent =
  | { type: "thinking.delta"; delta: string }
  | {
      type: "engine.question";
      requestId: string;
      toolCallId?: string | null;
      questions: EngineQuestion[];
    }
  | { type: "engine.question_settled"; requestId: string }
  | { type: "engine.todos"; items: EngineTodo[]; replace: boolean }
  | { type: "engine.plan_draft"; planId: string; text: string; replace: boolean }
  | { type: "engine.plan_review"; review: EnginePlanReview }
  | { type: "engine.plan_settled"; planId: string; revision: number; status: string }
  | { type: "engine.compaction"; active: boolean; reason?: string | null }
  | { type: "engine.retry"; attempt: number; max: number; message: string }
  | { type: "engine.model"; model?: string | null; effort?: string | null; requested?: boolean }
  | { type: "engine.background"; pending: number }
  | { type: "engine.title"; title: string }
  | { type: "engine.mode"; mode: string; engine: string }
  | { type: "engine.choice"; model?: string | null; effort?: string | null };

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

interface AiToolActivity {
  detail?: string;
  input?: unknown;
  result?: string;
  rows?: { title: string; meta?: string }[];
  output?: string;
}

export type AiProgressItem =
  | { type: "note"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      state: "running" | "completed" | "failed";
      activity?: AiToolActivity;
      durationMs?: number;
      error?: string;
      args?: unknown;
      result?: unknown;
      path?: string;
      pictures?: string[];
    };
