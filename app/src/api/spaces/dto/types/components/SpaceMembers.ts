import type { SpaceMember } from "../../interfaces/types";

export type MemberAction = { kind: "transfer" | "remove"; member: SpaceMember };
