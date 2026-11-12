import type { CollaborationEvent } from "../../plans/agentCollaboration";
import type { AppRequest } from "../../connected-apps/api";

import type { ScreenRequest, AiArtifact, AiCitation, MistyUndoReceipt } from "./invocationTypes";

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
      /** The chat's name, which a run sets as it ends if the chat has none yet. */
      type: "conversation.title";
      text: string;
    }
  | {
      id: string;
      /** A run's answer that becomes a proposal; `localRun/artifacts.ts` ends the run from here. */
      type: "local.artifact_answer";
      text: string;
    }
  | {
      id: string;
      /** New running notes on the chat's older turns; this device keeps them, the server doesn't. */
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
      /** The call's parameters as the engine sent them, for the row's payload viewer (diffs,
       * commands): on `tool.started`, or on the end event when only that knows them. Raw, so it
       * stays on this device with the chat. */
      args?: unknown;
      /** `tool.completed` and `tool.failed`: what the call returned, as text or JSON, clipped by
       * whoever sends it. */
      result?: unknown;
      /** The file the call worked on, when the engine names one. */
      path?: string;
      /** An outside engine's own sub-agent: the tool call (its Task) that started it. */
      parentToolCallId?: string;
    }
  | {
      id: string;
      /** How full the engine's context is. The buckets don't overlap; any may be missing. */
      type: "usage.updated";
      used?: number | null;
      window?: number | null;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      /** Of the output, the tokens spent reasoning, when the engine says. */
      reasoning?: number;
      /** What this reply cost in US dollars, when the engine says (Claude Code). */
      costUsd?: number;
      /** The model the engine says answered. */
      model?: string;
    }
  | {
      id: string;
      /** The engine refused a call on a folder outside the ones it may use. The chat offers to
       * add the folder; native code asks the person and decides. */
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
      /** How long the run took, when whoever ran it measured it. */
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
/** One choice on an engine's question card. */
export interface EngineQuestionOption {
  label: string;
  description: string;
}

/** A question an outside engine asks the person, with its options; free text is always allowed. */
export interface EngineQuestion {
  question: string;
  header: string;
  options: EngineQuestionOption[];
  multiSelect: boolean;
}

/** One item of an engine's todo list (Claude's TodoWrite, Codex's plan, an ACP plan). */
export interface EngineTodo {
  id?: string;
  content: string;
  status?: "pending" | "active" | "complete" | "blocked" | "dropped";
}

/** A plan an engine finished in Plan mode, waiting for the person's review. */
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

/** What outside engines report beyond Misty's own run events (`engines/bridge.rs`). */
export type EngineTurnEvent =
  /** More of the engine's reasoning; the chat folds it once the answer starts. */
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
  | { type: "engine.background"; pending: number };

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
  /** An outside engine's raw tool parameters. */
  input?: unknown;
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
      /** The call's raw parameters and result, when the run sent them (`tool.started`). */
      args?: unknown;
      result?: unknown;
      path?: string;
    };
