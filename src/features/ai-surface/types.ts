export const AI_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type AiSurfaceId =
  | "global"
  | "home"
  | "activity"
  | "space.chat"
  | "planner.tasks"
  | "planner.agenda"
  | "planner.roadmap"
  | "notes"
  | "drawings"
  | "library"
  | "inbox"
  | "browser"
  | "files"
  | "code"
  | "terminal"
  | "transfers"
  | "marketplace"
  | "extension"
  | "photo-editor"
  | "agents"
  | "settings";

export type AiInvocationMode = "quick" | "drawer" | "companion";
export type AiTrigger = "message" | "selection" | "object" | "schedule" | "event" | "handoff";
export type AiPrivacyClass = "shared" | "private" | "device" | "provider";
export type AiRisk = "observe" | "draft" | "consequential" | "dangerous";
export type AiApprovalPolicy =
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
  kind: "browser_tab";
  opaqueRef: string;
  displayName?: string;
  capabilities: string[];
  metadata?: Record<string, string | number | boolean>;
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
  | "mail_draft"
  | "message_draft"
  | "code_patch"
  | "terminal_command"
  | "browser_action"
  | "transfer_plan"
  | "extension_action"
  | "image_edit";

export interface AiArtifactTarget {
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

export interface AiCompanionRect {
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
  mode: AiInvocationMode;
  surfaceId: AiSurfaceId;
  trigger: AiTrigger;
  prompt: string;
  context: AiContextReference[];
  selection?: AiSelectionSnapshot;
  capture?: AiCaptureAttachment;
  attachmentIds?: string[];
  deviceContexts?: AiInvocationDeviceContext[];
  modelId?: string;
  reasoningEffort?: "" | "low" | "medium" | "high";
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
  idempotencyKey: string;
  timezone?: string;
}

export interface AiInvocationCreated {
  invocationId: string;
  conversationId?: string;
  state: AiInvocationState;
  eventsUrl: string;
}

export interface AiRunRoutingOption {
  space_id: string;
  space_name: string;
  agent_id: string;
  agent_name: string;
  capability_id: string;
  capability_name: string;
}

export interface AiRunCreated {
  status: string;
  agents_href?: string;
  replayed?: boolean;
  run?: { id: string; state: string; error_message?: string };
  routing?: {
    needs_clarification?: boolean;
    question?: string;
    options?: AiRunRoutingOption[];
    selected?: AiRunRoutingOption;
  };
}

export type AiInvocationState =
  "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "canceled";

export type AiInvocationEvent =
  | { id: string; type: "invocation.started"; state: AiInvocationState }
  | { id: string; type: "assistant.status"; text?: string; phase?: string }
  | { id: string; type: "response.delta"; delta: string }
  | { id: string; type: "assistant.message"; text: string; summary: string }
  | { id: string; type: "citation"; citation: AiCitation }
  | { id: string; type: "artifact.proposed"; artifact: AiArtifact }
  | { id: string; type: "approval.required"; artifact: AiArtifact }
  | { id: string; type: "effect.applied"; artifactId: string; summary: string }
  | { id: string; type: "undo.available"; receipt: MistyUndoReceipt }
  | { id: string; type: "run.started"; runId: string }
  | {
      id: string;
      type: "tool.started" | "tool.completed" | "tool.failed";
      toolCallId: string;
      toolName: string;
    }
  | { id: string; type: "invocation.completed"; state: AiInvocationState }
  | { id: string; type: "invocation.failed"; state: AiInvocationState; error: string }
  | { id: string; type: "invocation.canceled"; state: AiInvocationState };

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
