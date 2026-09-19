export const MISTY_AI_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type MistyAiSurfaceId =
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

export type MistyAiInvocationMode = "quick" | "drawer" | "companion";
export type MistyAiTrigger =
  "message" | "selection" | "object" | "schedule" | "event" | "handoff";
export type MistyAiPrivacyClass = "shared" | "private" | "device" | "provider";
export type MistyAiRisk = "observe" | "draft" | "consequential" | "dangerous";
export type MistyAiApprovalPolicy =
  | "none"
  | "auto_apply_with_undo"
  | "visible_apply"
  | "confirm"
  | "always_confirm";

export interface MistyAiContextReference {
  kind: string;
  id: string;
  title: string;
  privacy: MistyAiPrivacyClass;
  spaceId?: string;
  href?: string;
  revision?: string | number;
  opaqueScopeId?: string;
  attached?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface MistyAiSelectionSnapshot {
  kind: "text" | "blocks" | "canvas" | "objects" | "rows";
  content?: string;
  object: Pick<MistyAiContextReference, "kind" | "id" | "spaceId" | "revision">;
  anchors?: Record<string, string | number | boolean | null>;
  contentHash: string;
}

export type MistyAiArtifactKind =
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

export interface MistyAiArtifactTarget {
  kind: string;
  id: string;
  spaceId?: string;
  href?: string;
}

export interface MistyAiArtifact<TOperations = unknown> {
  id: string;
  schemaVersion: typeof MISTY_AI_ARTIFACT_SCHEMA_VERSION;
  kind: MistyAiArtifactKind;
  title: string;
  summary: string;
  sources: MistyAiCitation[];
  target?: MistyAiArtifactTarget;
  baseRevision?: string | number;
  operations: TOperations;
  risk: MistyAiRisk;
  approvalPolicy: MistyAiApprovalPolicy;
  idempotencyKey: string;
  expiresAt: string;
  state: "proposed" | "applying" | "applied" | "rejected" | "stale" | "failed";
  error?: string;
}

export interface MistyAiCitation {
  id: string;
  kind: string;
  title: string;
  href: string;
  revision?: string | number;
  excerpt?: string;
}

export interface MistyAiSuggestedAction {
  id: string;
  label: string;
  prompt: string;
  trigger?: MistyAiTrigger;
  requestedArtifactKind?: MistyAiArtifactKind;
}

/** Local component capability. Native and server operations still use named RPC methods.
 * Callbacks are bound to the owning view and invalidated when that view closes. */
export interface MistySurfaceAdapter {
  surfaceId: MistyAiSurfaceId;
  label: string;
  getContext(): MistyAiContextReference[];
  getSelection?(): MistyAiSelectionSnapshot | null;
  getSuggestedActions?(): MistyAiSuggestedAction[];
  canApply?(artifact: MistyAiArtifact): boolean;
  applyArtifact?(artifact: MistyAiArtifact): Promise<void>;
  undoArtifact?(artifact: MistyAiArtifact): void | Promise<void>;
  openCitation?(citation: MistyAiCitation): void;
  onArtifactApplied?(artifact: MistyAiArtifact): void | Promise<void>;
}
