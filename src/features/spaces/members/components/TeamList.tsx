import { AgentAvatar } from "@/features/agents";
import { personInitials } from "@/shared/lib/personInitials";
import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import type { MemberAction } from "@/api/spaces/dto/types/components/SpaceMembers";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  cn,
} from "@/shared/ui";
import { Ellipsis, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MemberPermissionControls } from "./MemberPermissionControls";

const rowClass = "flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3";

type TeamRow =
  | { kind: "member"; key: string; name: string; data: SpaceMember }
  | { kind: "agent"; key: string; name: string; data: SpaceAgentMembership };

export function TeamList({
  spaceId,
  members,
  agents,
  loading,
  owner,
  currentUserId,
  onMemberAction,
}: {
  spaceId: string;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  loading: boolean;
  owner: boolean;
  canManageAgents: boolean;
  currentUserId?: string;
  onMemberAction: (action: MemberAction) => void;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();

  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name])),
    [members],
  );
  const rows = useMemo<TeamRow[]>(() => {
    const memberRows: TeamRow[] = members.map((member) => ({
      kind: "member",
      key: `person:${member.user_id}`,
      name: member.name,
      data: member,
    }));
    const agentRows: TeamRow[] = agents.map((agent) => ({
      kind: "agent",
      key: `agent:${agent.agent_id}`,
      name: agent.name,
      data: agent,
    }));
    return [...memberRows, ...agentRows].sort((left, right) => left.name.localeCompare(right.name));
  }, [members, agents]);

  const openAgent = (agentId: string) => {
    navigate(`/agents?agent=${encodeURIComponent(agentId)}&space=${encodeURIComponent(spaceId)}`);
  };

  return (
    <Card className="overflow-hidden" aria-label="Space team">
      {loading ? <TeamSkeleton /> : null}
      {!loading
        ? rows.map((row, index) =>
            row.kind === "member" ? (
              <MemberRow
                key={row.key}
                member={row.data}
                bordered={index > 0}
                currentUserId={currentUserId}
                owner={owner}
                onMemberAction={onMemberAction}
              />
            ) : (
              <AgentRow
                key={row.key}
                agent={row.data}
                bordered={index > 0}
                ownerName={memberNames.get(row.data.owner_user_id) || "external creator"}
                onOpenAgent={openAgent}
              />
            ),
          )
        : null}
    </Card>
  );
}

function MemberRow({
  member,
  bordered,
  currentUserId,
  owner,
  onMemberAction,
}: {
  member: SpaceMember;
  bordered: boolean;
  currentUserId?: string;
  owner: boolean;
  onMemberAction: (action: MemberAction) => void;
}) {
  return (
    <div
      className={cn(
        "group transition-colors hover:bg-charcoal-card",
        rowClass,
        bordered && "border-t border-charcoal-border/60",
      )}
    >
      <Avatar className="size-10 shrink-0">
        <AvatarFallback
          className={cn("text-xs font-semibold", avatarColorClass(member.user_id), avatarInkClass)}
        >
          {personInitials(member.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="m-0 truncate text-sm font-medium text-cream">{member.name}</p>
          {member.user_id === currentUserId ? <Badge variant="secondary">You</Badge> : null}
        </div>
        <p className="mb-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-cream-muted">
          <Mail className="size-3 shrink-0" /> {member.email}
        </p>
      </div>
      <Badge className="hidden capitalize sm:inline-flex" variant="outline">
        {member.role}
      </Badge>
      {owner && member.role !== "owner" ? (
        <div className="flex shrink-0 items-center gap-1">
          <MemberPermissionControls
            spaceId={member.space_id}
            userId={member.user_id}
            memberName={member.name}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={`Actions for ${member.name}`}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onMemberAction({ kind: "transfer", member })}>
                <ShieldCheck className="mr-2 size-4" /> Transfer ownership
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-cream-bright focus:text-cream-bright"
                onSelect={() => onMemberAction({ kind: "remove", member })}
              >
                <Trash2 className="mr-2 size-4" /> Remove member
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

function AgentRow({
  agent,
  bordered,
  ownerName,
  onOpenAgent,
}: {
  agent: SpaceAgentMembership;
  bordered: boolean;
  ownerName: string;
  onOpenAgent: (agentId: string) => void;
}) {
  return (
    <div
      className={cn(
        rowClass,
        "transition-colors hover:bg-charcoal-card",
        bordered && "border-t border-charcoal-border/60",
      )}
    >
      <AgentAvatar
        agentId={agent.agent_id}
        avatar={agent.avatar}
        legacyIcon={agent.icon}
        name={agent.name}
        className="size-10"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="link"
            className="h-auto min-w-0 truncate p-0 text-left text-sm font-medium"
            onClick={() => onOpenAgent(agent.agent_id)}
          >
            {agent.name}
          </Button>
          <Badge variant="secondary">Agent</Badge>
          {(agent.attention_count ?? 0) > 0 ? (
            <Badge variant="destructive">{agent.attention_count}</Badge>
          ) : null}
        </div>
        <p className="mb-0 mt-0.5 truncate text-xs text-cream-muted">
          Companion Agent · owner {ownerName}
        </p>
      </div>
      <WorkStateBadge state={agent.work_state || (agent.enabled ? "ready" : "disabled")} />
    </div>
  );
}

function WorkStateBadge({ state }: { state: NonNullable<SpaceAgentMembership["work_state"]> }) {
  const labels = {
    ready: "Ready",
    queued: "Queued",
    working: "Working",
    awaiting_approval: "Awaiting approval",
    awaiting_device: "Waiting for device",
    needs_approval: "Needs approval",
    retrying: "Retrying",
    completed: "Ready",
    failed: "Failed",
    canceled: "Canceled",
    disabled: "Disabled",
    update_available: "Update available",
  } as const;
  return (
    <Badge
      variant={
        state === "failed" || state === "needs_approval"
          ? "destructive"
          : state === "working"
            ? "default"
            : "outline"
      }
      className="hidden shrink-0 sm:inline-flex"
    >
      {labels[state]}
    </Badge>
  );
}

function TeamSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading team</span>
      {[0, 1, 2].map((index) => (
        <div className={`${rowClass} ${index ? "border-t" : ""}`} key={index}>
          <Skeleton className="size-10 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}
