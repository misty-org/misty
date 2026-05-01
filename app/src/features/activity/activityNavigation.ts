import type { ActivityTarget } from "./types";

export function activityTargetHref(target: ActivityTarget): string | null {
  switch (target.kind) {
    case "space":
      return `/spaces/${encodeURIComponent(target.spaceId)}`;
    case "space-chat": {
      const base = `/spaces/${encodeURIComponent(target.spaceId)}/chat`;
      return target.messageId ? `${base}?message=${encodeURIComponent(target.messageId)}` : base;
    }
    case "space-task":
      return `/spaces/${encodeURIComponent(target.spaceId)}/planner/tasks/board?task=${encodeURIComponent(target.taskId)}`;
    case "workspace-tool":
      return `/${target.tool}`;
    default:
      return null;
  }
}
