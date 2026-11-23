import type { DisplayCapture } from "../../tutor/cursor/protocol";
import type { LessonPayload, LessonSummaryPayload } from "../../tutor/lessons/lesson_types";

import type { AiInvocationState } from "./invocation_event_types";

export interface ScreenRequest {
  kind: "open" | "look" | "desktop";
  url?: string;
  reason: string;
  location: "window" | "ask";
  chosen?: boolean;
  state?: "pending" | "opening" | "opened" | "declined" | "failed";
  error?: string;
}
export const AI_ARTIFACT_SCHEMA_VERSION = 1 as const;
export type AiSurfaceId =
  "global" | "space.chat" | "browser" | "extensions" | "files" | "agents" | "settings";
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
  kind: "browser_tab" | "local_folder" | "workspace";
  opaqueRef: string;
  displayName?: string;
  capabilities: string[];
  metadata?: Record<string, string | number | boolean>;
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
  | "message_draft"
  | "terminal_command"
  | "browser_action"
  | "transfer_plan"
  | "extension_action";
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
  engineId?: string;
  images?: { mimeType: string; dataUrl: string }[];
  spaceId?: string;
  profile?: string;
  originDeviceId?: string;
  historyTurns?: { invocation_id?: string; prompt: string; reply?: string; created_at: string }[];
  historyNotes?: unknown;
  companionMode?: "team" | "auto";
  displayCaptures?: DisplayCapture[];
  agentId?: string;
  taskId?: string;
  executionMode?: "user" | "agent";
  windowLabel?: string;
  currentTab?: { title: string; url: string };
  mode: AiInvocationMode;
  surfaceId: AiSurfaceId;
  trigger: AiTrigger;
  prompt: string;
  context: AiContextReference[];
  selection?: AiSelectionSnapshot;
  capture?: AiCaptureAttachment;
  attachmentIds?: string[];
  attachmentNames?: Record<string, string>;
  deviceContexts?: AiInvocationDeviceContext[];
  thinkingMode?: "normal" | "deep";
  modelId?: string;
  reasoningEffort?: "" | "low" | "medium" | "high" | "xhigh";
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
  collaborationMode?: "act" | "plan" | "teach";
  parentRunId?: string;
  notebookKey?: string;
  delegatedFrom?: string;
  evalTurnLimit?: number;
  lesson?: LessonPayload;
  lessonIndex?: LessonSummaryPayload[];
  permissionMode?: string;
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

export type * from "./invocation_event_types";
