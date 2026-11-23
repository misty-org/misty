import { useAuth } from "@/features/account";
import { useSpacesStore } from "../list/use_spaces_store";

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
    const name = agentName || "Agent";
    return userId ? `${name} by ${person(userId)}` : name;
  };
}
