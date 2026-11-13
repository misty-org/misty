import type { DisplayCapture } from "../../tutor/cursor/protocol";
import type { LessonPayload, LessonSummaryPayload } from "../../tutor/lessons/lessonTypes";

import type { AiInvocationState } from "./invocationEventTypes";

/**
 * A run that needs a screen asks for one and ends its response. The desktop
 * opens it where the account setting says, then continues the conversation.
 */
export interface ScreenRequest {
  /** A browser screen, a look at the user's screen, or the user's desktop apps. */
  kind: "open" | "look" | "desktop";
  url?: string;
  reason: string;
  /** window: a new tab in the person's window; ask: wait for the card. */
  location: "window" | "ask";
  /** The user named where to work; otherwise a matching open tab is reused first. */
  chosen?: boolean;
  /** Client progress: waiting for a choice, opening, or done. */
  state?: "pending" | "opening" | "opened" | "declined" | "failed";
  error?: string;
}
export const AI_ARTIFACT_SCHEMA_VERSION = 1 as const;
export type AiSurfaceId =
  | "global"
  | "space.chat"
  | "notes"
  | "drawings"
  | "library"
  | "browser"
  | "extensions"
  | "files"
  | "photo-editor"
  | "agents"
  | "settings";
type AiInvocationMode = "quick" | "drawer" | "companion";
type AiTrigger =
  "message" | "selection" | "object" | "event" | "handoff" | "continuation" | "delegated";
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
  /** A browser tab, a folder shared with agents, or the Misty browser itself. */
  kind: "browser_tab" | "local_folder" | "workspace";
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
  | "message_draft"
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
  /** The run that proposed it, told when the proposal is applied. */
  invocationId?: string;
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
  /** The Space of the window it came from; a new conversation joins it. */
  spaceId?: string;
  /** The profile of the window it came from, whose sign-ins the run uses. */
  profile?: string;
  /** The computer it was sent from, where the run works. */
  originDeviceId?: string;
  /** The chat's earlier turns, oldest first: the server keeps no transcript. */
  historyTurns?: { invocation_id?: string; prompt: string; reply?: string; created_at: string }[];
  /** The chat's running notes on older turns, as the last run sent them. */
  historyNotes?: unknown;
  companionMode?: "team" | "auto";
  displayCaptures?: DisplayCapture[];
  agentId?: string;
  taskId?: string;
  executionMode?: "user" | "agent";
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
  /** Each attachment's file name, kept on this computer for uploading it. Never sent. */
  attachmentNames?: Record<string, string>;
  deviceContexts?: AiInvocationDeviceContext[];
  thinkingMode?: "normal" | "deep";
  modelId?: string;
  reasoningEffort?: "" | "low" | "medium" | "high" | "xhigh";
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
  /** Plan researches and proposes; Act does the work; Teach is a lesson. Omitted uses the conversation's mode. */
  collaborationMode?: "act" | "plan" | "teach";
  /** A sub-agent: it shows in this run, and works in its notebook. */
  parentRunId?: string;
  notebookKey?: string;
  /** How a sub-agent's prompt was started, which keeps it from starting its own. */
  delegatedFrom?: string;
  /** More model turns than a run gets, for a benchmark. Debug builds only. */
  evalTurnLimit?: number;
  /** A Teach turn's lesson and the paused lessons it may resume, kept on this device. */
  lesson?: LessonPayload;
  lessonIndex?: LessonSummaryPayload[];
  /** The engine's own mode id for this turn (or an older ask, auto or bypass). Omitted uses the chat's choice or its agent's default. */
  permissionMode?: string;
  /** Screen and input control for an outside engine, which the person turned on for this send. */
  computerUse?: boolean;
  idempotencyKey: string;
  timezone?: string;
}
export interface AiInvocationCreated {
  invocationId: string;
  conversationId?: string;
  state: AiInvocationState;
  eventsUrl: string;
}

export type * from "./invocationEventTypes";
