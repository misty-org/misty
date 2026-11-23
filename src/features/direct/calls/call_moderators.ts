import { memberCan, prepareMemberCan } from "@/features/spaces";

export function moderatesVoice(spaceId: string, userId: string): boolean {
  return memberCan(spaceId, userId, "members.remove");
}

export function prepareVoiceModerators(spaceId: string): void {
  void prepareMemberCan(spaceId).catch(() => undefined);
}
