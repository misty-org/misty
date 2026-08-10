export function composeAgentInstructions(
  personality: string,
  communicationStyle: string,
  instructions: string,
): string {
  return [
    `Personality: ${personality.trim()}.`,
    `Communication style: ${communicationStyle.trim()}.`,
    instructions.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function agentSpaceAudienceGrants(
  spaceIds: string[],
  access: Record<string, "all_members" | "creator_only">,
  creatorUserId?: string,
) {
  return spaceIds.map((spaceId) => ({
    space_id: spaceId,
    all_members: (access[spaceId] ?? "all_members") === "all_members",
    member_user_ids:
      (access[spaceId] ?? "all_members") === "creator_only" && creatorUserId ? [creatorUserId] : [],
  }));
}
