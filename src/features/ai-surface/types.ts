import type { CollaborationEvent } from "@/features/agents/agentCollaboration";
import type { DisplayCapture } from "@/features/agents";
import type { AppRequest } from "@/features/agents";

/**
 * A run that needs a screen asks for one and ends its response. The desktop
 * opens it where the account setting says, then continues the conversation.
 */
export interface ScreenRequest {
  /** A browser screen, a look at the user's screen, or the user's desktop apps. */
  kind: "open" | "look" | "desktop";
  url?: string;
  reason: string;
  /** current: the user's tab; window: a new tab in their window; separate: an agent window;
   * remote: a browser another of the person's devices opened for this request. */
  location: "current" | "separate" | "window" | "ask" | "remote";
  /** The user named where to work; otherwise a matching open tab is reused first. */
  chosen?: boolean;
  /** The browser session another device opened, with the tab it signed for. */
  remote?: {
    deviceId: string;
    deviceName: string;
    contexts: Array<{
      device_id: string;
      kind: "browser_tab";
      opaque_ref: string;
      display_name?: string;
      capabilities: string[];
      metadata?: Record<string, string | number | boolean>;
      run_grant?: { payload: string; signature: string };
    }>;
  };
  /** Client progress: waiting for a choice, opening, or done. */
  state?: "pending" | "opening" | "opened" | "declined" | "failed";
  error?: string;
}
export const AI_ARTIFACT_SCHEMA_VERSION = 1 as const;
export type AiSurfaceId =
  | "global"
  | "activity"
  | "space.chat"
  | "notes"
  | "drawings"
  | "library"
  | "browser"
  | "extensions"
  | "files"
  | "photo-editor"
  | "scheduled"
  | "agents"
  | "settings";
type AiInvocationMode = "quick" | "drawer" | "companion";
type AiTrigger =
  | "message"
  | "selection"
  | "object"
  | "schedule"
  | "scheduled_task"
  | "event"
  | "handoff"
  | "continuation";
type AiPrivacyClass = "shared" | "private" | "device" | "provider";
type AiRisk = "observe" | "draft" | "consequential" | "dangerous";
type AiApprovalPolicy =
  "none" | "auto_apply_with_undo" | "visible_apply" | "confirm" | "always_confirm";
export interface AiContextReference {
  kind: string;
  id: string;
  title: string;
  privacy: AiPrivacyClass;
  spaceId?: string;
  href?: string;
  revision?: string | number;
  opaqueScopeId?: string;
  attached?: boolean;
  metadata?: Record<string, string | number | boolean>;
}
export interface AiInvocationDeviceContext {
  deviceId: string;
  /** A browser tab, a folder shared with agents, a project, or the Misty browser itself. */
  kind: "browser_tab" | "local_folder" | "project_folder" | "workspace";
  opaqueRef: string;
  displayName?: string;
  capabilities: string[];
  metadata?: Record<string, string | number | boolean>;
  /** Signed by the device that asked; required by the server. */
  runGrant?: { payload: string; signature: string };
}
export interface AiSelectionSnapshot {
  kind: "text" | "blocks" | "canvas" | "objects" | "rows";
  content?: string;
  object: Pick<AiContextReference, "kind" | "id" | "spaceId" | "revision">;
  anchors?: Record<string, string | number | boolean | null>;
  contentHash: string;
}
export interface AiCaptureAttachment {
  id: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  contentHash: string;
}
export type AiArtifactKind =
  | "text_patch"
  | "task_set"
  | "calendar_event"
  | "roadmap_patch"
  | "drawing_patch"
  | "file_plan"
  | "message_draft"
  | "code_patch"
  | "terminal_command"
  | "browser_action"
  | "transfer_plan"
  | "extension_action"
  | "image_edit";
interface AiArtifactTarget {
  kind: string;
  id: string;
  spaceId?: string;
  href?: string;
}
export interface AiArtifact<TOperations = unknown> {
  id: string;
  schemaVersion: typeof AI_ARTIFACT_SCHEMA_VERSION;
  kind: AiArtifactKind;
  title: string;
  summary: string;
  sources: AiCitation[];
  target?: AiArtifactTarget;
  baseRevision?: string | number;
  operations: TOperations;
  risk: AiRisk;
  approvalPolicy: AiApprovalPolicy;
  idempotencyKey: string;
  expiresAt: string;
  state: "proposed" | "applying" | "applied" | "rejected" | "stale" | "failed";
  error?: string;
}
export interface AiCitation {
  id: string;
  kind: string;
  title: string;
  href: string;
  revision?: string | number;
  excerpt?: string;
}
export interface AiSuggestedAction {
  id: string;
  label: string;
  prompt: string;
  trigger?: AiTrigger;
  requestedArtifactKind?: AiArtifactKind;
}
export type MistyPresencePhase =
  "home" | "following" | "composing" | "working" | "speaking" | "awaiting_approval" | "returning";
export interface MistySpeech {
  id: string;
  kind: "status" | "reply" | "error" | "clarification";
  text: string;
  fullText?: string;
  conversationId?: string;
  createdAt: string;
  persistent?: boolean;
}
export interface MistyApprovalPrompt {
  artifact: AiArtifact;
  title: string;
  summary: string;
  confirmLabel: string;
}
export interface MistyUndoReceipt {
  id: string;
  artifactId: string;
  title: string;
  expiresAt: string;
}
interface AiCompanionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Client-only presentation geometry. It is never included in an invocation request. */
export interface AiCompanionAnchor {
  kind: "pointer" | "selection" | "object" | "element" | "focus";
  paneId: string;
  x?: number;
  y?: number;
  rect?: AiCompanionRect;
  surfaceRevision?: string | number;
}
export interface AiSurfaceAdapter {
  surfaceId: AiSurfaceId;
  label: string;
  getContext: () => AiContextReference[];
  getSelection?: () => AiSelectionSnapshot | null;
  getAnchor?: () => Omit<AiCompanionAnchor, "paneId"> | null;
  getSuggestedActions?: () => AiSuggestedAction[];
  canApply?: (artifact: AiArtifact) => boolean;
  applyArtifact?: (artifact: AiArtifact) => Promise<void>;
  undoArtifact?: (artifact: AiArtifact) => void | Promise<void>;
  highlightArtifactTarget?: (artifact: AiArtifact) => void | (() => void);
  onArtifactApplied?: (artifact: AiArtifact, result?: unknown) => void | Promise<void>;
  openCitation?: (citation: AiCitation) => void;
}
export interface AiInvocationRequest {
  /** A scheduled run this computer claimed and is starting (roadmap C1). */
  scheduleId?: string;
  scheduleClaim?: string;
  methodVersionId?: string;
  methodInputs?: Record<string, string | number | boolean>;
  skillVersionIds?: string[];
  companionMode?: "team" | "auto";
  companionModel?: string;
  /** Pins a new conversation's Thinking model with its first message. */
  modelOverride?: string;
  displayCaptures?: DisplayCapture[];
  agentId?: string;
  taskId?: string;
  executionMode?: "user" | "agent" | "team";
  windowLabel?: string;
  /** The Misty browser tab in front of the user, so "this page" has a referent. */
  currentTab?: { title: string; url: string };
  mode: AiInvocationMode;
  surfaceId: AiSurfaceId;
  trigger: AiTrigger;
  prompt: string;
  context: AiContextReference[];
  selection?: AiSelectionSnapshot;
  capture?: AiCaptureAttachment;
  attachmentIds?: string[];
  deviceContexts?: AiInvocationDeviceContext[];
  thinkingMode?: "normal" | "deep";
  modelId?: string;
  reasoningEffort?: "" | "low" | "medium" | "high" | "xhigh";
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
  /** Plan researches and proposes; Act does the work. Omitted uses the conversation's mode. */
  collaborationMode?: "act" | "plan";
  /** Ask or Auto for this turn. Omitted uses the chat's choice or its agent's default. */
  permissionMode?: "ask" | "auto";
  /** The coding tool a delegated coding run uses this turn; omitted uses the Settings default. */
  codingTool?: string;
  idempotencyKey: string;
  timezone?: string;
}
export interface AiInvocationCreated {
  invocationId: string;
  conversationId?: string;
  state: AiInvocationState;
  eventsUrl: string;
}
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
