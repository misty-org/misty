import type { SpaceAgent } from "@/features/agents";
import { useAuth } from "@/features/account";
import { usePersonalAgentsStore } from "@/features/agents";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@misty/ui";
import { CopyPlus } from "lucide-react";
import { useEffect } from "react";

export function BringAgentMenu({
  agents,
  spaceId,
  onBring,
}: {
  agents: SpaceAgent[] | undefined;
  spaceId: string;
  onBring: (agentId: string) => void;
}) {
  const { user } = useAuth();
  const mine = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    if (user?.id) void usePersonalAgentsStore.getState().load(user.id);
  }, [user?.id]);
  const here = new Set((agents ?? []).map((agent) => agent.agent_id));
  const available = mine.filter(
    (agent) =>
      !agent.system_managed && agent.space_id !== spaceId && !here.has(agent.id),
  );
  if (!agents || !available.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" icon={CopyPlus}>
          Copy an agent here
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
