import type { SpaceAgent } from "@/api/spaces/space-agents";
import { useAuth } from "@/features/auth";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@/shared/ui";
import { Bot } from "lucide-react";
import { useEffect } from "react";

/** Your agents that aren't in this Space yet; picking one brings it in. */
export function BringAgentMenu({
  agents,
  currentUserId,
  onBring,
}: {
  agents: SpaceAgent[] | undefined;
  currentUserId: string | undefined;
  onBring: (agentId: string) => void;
}) {
  const { user } = useAuth();
  const mine = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    if (user?.id) void usePersonalAgentsStore.getState().load(user.id);
  }, [user?.id]);
  const here = new Set(
    (agents ?? [])
      .filter((agent) => agent.owner_user_id === currentUserId)
      .map((agent) => agent.agent_id),
  );
  const available = mine.filter((agent) => agent.enabled && !here.has(agent.id));
  if (!agents || !available.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline">
          <Bot className="size-4" /> Bring an agent
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {available.map((agent) => (
          <MenuItem key={agent.id} label={agent.name} onSelect={() => onBring(agent.id)} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
