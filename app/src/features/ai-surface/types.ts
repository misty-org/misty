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
  | "extensions"
  | "photo-editor"
  | "agents"
  | "settings";

export type AiInvocationMode = "quick" | "drawer";
export type AiTrigger = "message" | "selection" | "object" | "schedule" | "event" | "handoff";
export type AiPrivacyClass = "shared" | "private" | "device" | "provider";
export type AiRisk = "observe" | "draft" | "consequential" | "dangerous";
export type AiApprovalPolicy = "none" | "visible_apply" | "confirm" | "always_confirm";

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

export interface AiSelectionSnapshot {
  kind: "text" | "blocks" | "canvas" | "objects" | "rows";
  content?: string;
  object: Pick<AiContextReference, "kind" | "id" | "spaceId" | "revision">;
  anchors?: Record<string, string | number | boolean | null>;
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

export interface AiSurfaceAdapter {
  surfaceId: AiSurfaceId;
  label: string;
  getContext: () => AiContextReference[];
  getSelection?: () => AiSelectionSnapshot | null;
  getSuggestedActions?: () => AiSuggestedAction[];
  canApply?: (artifact: AiArtifact) => boolean;
  applyArtifact?: (artifact: AiArtifact) => Promise<void>;
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
  requestedArtifactKind?: AiArtifactKind;
  conversationId?: string;
  agentId?: string;
  idempotencyKey: string;
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
  | { id: string; type: "response.delta"; delta: string }
  | { id: string; type: "citation"; citation: AiCitation }
  | { id: string; type: "artifact.proposed"; artifact: AiArtifact }
  | { id: string; type: "invocation.completed"; state: AiInvocationState }
  | { id: string; type: "invocation.failed"; state: AiInvocationState; error: string }
  | { id: string; type: "invocation.canceled"; state: AiInvocationState };

export interface AiDrawerMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations: AiCitation[];
  artifacts: AiArtifact[];
  invocationId?: string;
}
