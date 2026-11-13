import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/useSpacesStore";

/** Space membership is loaded by the workspace and refreshed by member events. */
export function useSpaceItemCreator(spaceId: string) {
  const { user } = useAuth();
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const person = (userId?: string) => {
    if (!userId) return "Unknown";
    if (userId === user?.id) return user.username?.trim() || "You";
    return members?.find((member) => member.user_id === userId)?.name?.trim() || "Unknown member";
  };
  return (userId?: string, agentId?: string, agentName?: string) => {
    if (!agentId) return person(userId);
    // An agent's name is free text, so someone could call theirs "Alice's Misty": whose it really is
    // always shows beside it.
    const name = agentName || "Agent";
    return userId ? `${name} · ${person(userId)}` : name;
  };
}
