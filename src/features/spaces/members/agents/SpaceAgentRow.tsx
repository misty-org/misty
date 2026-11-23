import type { SpaceAgent } from "@/features/agents";
import type { ItemVisibility } from "../../api/visibility";
import { PrivateLabel, VisibilityMenu } from "../../components/VisibilityMenu";
import { AgentAvatar } from "@/features/agents";
import { useAuth } from "@/features/account";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, Text, cn } from "@misty/ui";
import { X } from "lucide-react";
import { agentOwnerLabel } from "./use_space_agent_members";

export function SpaceAgentRow({
  agent,
  compact = false,
  onRemove,
  onVisibilityChange,
}: {
  agent: SpaceAgent;
  compact?: boolean;
  onRemove?: () => void;
  onVisibilityChange?: (visibility: ItemVisibility) => void;
}) {
  const { user } = useAuth();
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        compact
          ? "min-h-9 gap-2.5 rounded-md py-1 pl-6 pr-1.5"
          : "min-h-10 gap-3 py-1 pl-12 pr-1.5",
      )}
    >
      <span className={cn("inline-flex shrink-0", compact ? "size-7" : "size-8")}>
        <AgentAvatar
          agent={
            {
              id: agent.agent_id,
              name: agent.agent_name,
              avatar: {},
              system_managed: false,
            } as AgentProfile
          }
          compact={compact}
        />
      </span>
      <div className="min-w-0 flex-1">
        <Text as="p" full tone="default" size={compact ? "meta" : "control"} className="m-0">
          {agent.agent_name}
          <Text bare tone="muted" className="font-normal">
            {`, ${agentOwnerLabel(agent, user?.id)}`}
          </Text>
        </Text>
      </div>
      {agent.visibility === "private" ? <PrivateLabel /> : null}
      {onVisibilityChange ? (
        <VisibilityMenu
          label={agent.agent_name}
          visibility={agent.visibility}
          onChange={onVisibilityChange}
        />
      ) : null}
      {onRemove ? (
        <IconButton label={`Remove ${agent.agent_name} from this Space`} onClick={onRemove}>
          <X />
        </IconButton>
      ) : null}
    </div>
  );
}
