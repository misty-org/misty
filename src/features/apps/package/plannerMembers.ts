import type { SpaceMember as SDKMember, SpaceAgentMembership as SDKAgent } from "@misty/sdk";
import type {
  AgentAvatar,
  SpaceAgentMembership,
  SpaceMember,
} from "@/api/spaces/dto/interfaces/agentTaskTypes";
import { plannerEnum, plannerRecord } from "@/features/spaces/planner/plannerValues";

export function plannerMember(value: SDKMember): SpaceMember {
  return { ...value, role: plannerEnum(value.role, ["owner", "member"]) };
}
export function plannerAgent(value: SDKAgent): SpaceAgentMembership {
  const source = value.avatar == null ? undefined : plannerRecord(value.avatar);
  let avatar: AgentAvatar | undefined;
  if (
    source?.kind === "preset" &&
    typeof source.preset_id === "string" &&
    typeof source.accent === "string"
  )
    avatar = { kind: "preset", preset_id: source.preset_id, accent: source.accent };
  if (
    source?.kind === "upload" &&
    typeof source.asset_id === "string" &&
    typeof source.version === "number"
  )
    avatar = { kind: "upload", asset_id: source.asset_id, version: source.version };
  return {
    ...value,
    avatar,
    default_run_mode: plannerEnum(value.default_run_mode, ["ask", "auto", "full"]),
    reasoning_effort: value.reasoning_effort
      ? plannerEnum(value.reasoning_effort, ["low", "medium", "high"])
      : undefined,
    work_state: value.work_state
      ? plannerEnum(value.work_state, [
          "ready",
          "queued",
          "working",
          "awaiting_approval",
          "awaiting_device",
          "needs_approval",
          "retrying",
          "completed",
          "failed",
          "canceled",
          "disabled",
          "update_available",
        ])
      : undefined,
    last_activity_at: value.last_activity_at ?? undefined,
  };
}
