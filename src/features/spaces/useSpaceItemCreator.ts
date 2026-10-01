import { useAuth } from "@/features/auth";
import { useSpacesStore } from "./store/useSpacesStore";

/** Space membership is loaded by the workspace and refreshed by member events. */
export function useSpaceItemCreator(spaceId: string) {
  const { user } = useAuth();
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  return (userId?: string, agentId?: string) => {
    if (agentId) return "Agent";
    if (!userId) return "Unknown";
    if (userId === user?.id) return user.name?.trim() || "You";
    return members?.find((member) => member.user_id === userId)?.name?.trim() || "Unknown member";
  };
}
