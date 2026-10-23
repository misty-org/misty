import type { SpaceAgent } from "@/api/spaces/space-agents";
import type { ItemVisibility } from "@/api/spaces/visibility";
import { PrivateLabel, VisibilityMenu } from "../../components/VisibilityMenu";
import { AgentAvatar } from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, cn } from "@/shared/ui";
import { X } from "lucide-react";

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
              avatar: agent.agent_avatar ?? {},
              system_managed: agent.system_managed,
            } as AgentProfile
          }
          compact={compact}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("m-0 truncate font-medium text-cream", compact ? "text-xs" : "text-sm")}>
          {agent.agent_name}
        </p>
        {agent.agent_role && !compact ? (
          <p className="m-0 truncate text-xs text-cream-muted">{agent.agent_role}</p>
        ) : null}
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
        <IconButton
          size="sm"
          label={`Remove ${agent.agent_name} from this Space`}
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}
