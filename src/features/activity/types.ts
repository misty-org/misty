export type ActivityCategory =
  "conversations" | "invitations" | "reminders" | "requests" | "completions";

export type ActivityKind =
  | "mention"
  | "reply"
  | "message"
  | "invitation"
  | "approval"
  | "reminder"
  | "failure"
  | "completion"
  | "agent"
  | "workflow"
  | "system";

export type ActivityTarget =
  | { kind: "space"; spaceId: string }
  | { kind: "space-chat"; spaceId: string; messageId?: string }
  | { kind: "space-task"; spaceId: string; taskId: string }
  | {
      kind: "workspace-tool";
      tool: "files" | "agents" | "marketplace" | "transfers";
    }
  | { kind: "route"; href: string }
  | { kind: "none" };

export interface ActivityItem {
  id: string;
  accountId: string;
  source: "spaces" | "invitation" | "device" | "capabilities" | "interventions";
  sourceId: string;
  deploymentScope?: string;
  spaceId?: string;
  appId?: string;
  sourceLabel?: string;
  lifecycle?: "update" | "request";
  revision?: number;
  status?: "running" | "blocked" | "completed" | "resolved";
  resolvedAt?: string;
  updatedAt?: string;
  historySequence?: number;
  dismissible?: boolean;
  kind: ActivityKind;
  visibility?: "activity" | "diagnostic";
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
  attention: boolean;
  target: ActivityTarget;
}

export interface LocalActivityInput {
  id?: string;
  spaceId?: string;
  appId?: string;
  sourceLabel?: string;
  lifecycle?: "update" | "request";
  revision?: number;
  status?: "running" | "blocked" | "completed" | "resolved";
  dismissible?: boolean;
  accountId?: string;
  kind: Extract<ActivityKind, "reminder" | "failure" | "completion" | "system">;
  visibility?: "activity" | "diagnostic";
  title: string;
  body?: string;
  createdAt?: string;
  attention?: boolean;
  target?: ActivityTarget;
  notify?: boolean;
}

export type NativeNotificationPermission = "granted" | "prompt" | "denied" | "unsupported";
