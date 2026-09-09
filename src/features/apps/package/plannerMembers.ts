import type { SpaceMember as SDKMember } from "@misty/sdk";
import type { SpaceMember } from "@/api/spaces/dto/interfaces/agentTaskTypes";
import { plannerEnum } from "@/features/spaces/planner/plannerValues";

export function plannerMember(value: SDKMember): SpaceMember {
  return { ...value, role: plannerEnum(value.role, ["owner", "member"]) };
}
