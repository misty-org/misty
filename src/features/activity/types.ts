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
      tool: "files" | "agents" | "extensions" | "transfers";
    }
  | { kind: "none" };

export interface ActivityItem {
  id: string;
  accountId: string;
  source: "spaces" | "invitation" | "device";
  sourceId: string;
  kind: ActivityKind;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
  attention: boolean;
  target: ActivityTarget;
}

export interface LocalActivityInput {
  id?: string;
  accountId?: string;
  kind: Extract<ActivityKind, "reminder" | "failure" | "completion" | "system">;
  title: string;
  body?: string;
  createdAt?: string;
  attention?: boolean;
  target?: ActivityTarget;
  notify?: boolean;
}

export type NativeNotificationPermission = "granted" | "prompt" | "denied" | "unsupported";
