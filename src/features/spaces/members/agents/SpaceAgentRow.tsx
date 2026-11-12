import type { SpaceAgent } from "@/features/agents";
import type { ItemVisibility } from "../../api/visibility";
import { PrivateLabel, VisibilityMenu } from "../../components/VisibilityMenu";
import { AgentAvatar } from "@/features/agents";
import { useAuth } from "@/features/account";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, OverflowFadeText, cn } from "@/shared/ui";
import { X } from "lucide-react";
import { agentOwnerLabel } from "./useSpaceAgentMembers";

/** One agent, shown under the person who brought it. */
export function SpaceAgentRow({
  agent,
  compact = false,
  onRemove,
  onVisibilityChange,
}: {
  agent: SpaceAgent;
  compact?: boolean;
  /** Offered to the agent's owner and the Space's owner. */
  onRemove?: () => void;
  /** Offered to the agent's owner only. */
  onVisibilityChange?: (visibility: ItemVisibility) => void;
}) {
  const { user } = useAuth();
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        compact ? "min-h-9 gap-2.5 rounded-md py-1 pl-6 pr-1.5" : "min-h-12 gap-3 py-2 pl-14 pr-4",
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
        <OverflowFadeText
          as="p"
          full
          className={cn("m-0 font-medium text-cream", compact ? "text-xs" : "text-sm")}
        >
          {agent.agent_name}
          <span className="font-normal text-cream-muted">
            {" "}
            · {agentOwnerLabel(agent, user?.id)}
          </span>
        </OverflowFadeText>
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
          <X className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}
