import { useEffect, useMemo, useState } from "react";
import { Settings2, UserPlus, UsersRound } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  Avatar,
  AvatarFallback,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
} from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type {
  Space,
  SpaceAgentMembership,
  SpaceMember,
} from "@/models/interfaces/features/spaces/types";
import type { SpacePresenceViewer } from "@/models/types/stores/spaces/useSpacesBackendStore";
import { personInitials } from "../personInitials";
import { AgentAvatar } from "@/features/agents/AgentAvatar";

const emptyMembers: SpaceMember[] = [];
const emptyViewers: SpacePresenceViewer[] = [];
const emptyAgents: SpaceAgentMembership[] = [];

type PresenceStatus = "online" | "idle" | "offline";
type PresentMember = SpaceMember & { presenceStatus: PresenceStatus };

export function SpaceMembersPopover({ space }: { space: Space }) {
  const { user } = useAuth();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { members, agents, viewers, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[space.id] ?? emptyMembers,
      agents: state.agentMembershipsBySpace[space.id] ?? emptyAgents,
      viewers: state.presenceBySpace[space.id] ?? emptyViewers,
      loadMembers: state.loadMembers,
    })),
  );

  useEffect(() => {
    if (!open || members.length > 0) return;
    let cancelled = false;
    setLoading(true);
    void loadMembers(space.id)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadMembers, members.length, open, space.id]);

  const groupedMembers = useMemo(
    () => groupMembersByPresence(members, viewers, user?.id),
    [members, user?.id, viewers],
  );
  const onlineCount = groupedMembers.online.length;
  const orderedMembers = [
    ...groupedMembers.online,
    ...groupedMembers.idle,
    ...groupedMembers.offline,
  ];
  const managePath = `/spaces/${encodeURIComponent(space.id)}/settings/members`;
  const settingsState = {
    spaceSettingsReturnTo: `${location.pathname}${location.search}${location.hash}`,
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            "relative grid size-8 place-items-center rounded-md p-0 text-muted-foreground shadow-none",
            "hover:bg-accent/65 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-accent text-accent-foreground",
          )}
          variant="ghost"
          size="icon"
          type="button"
          title="Team"
          aria-label="Space team"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <UsersRound size={16} strokeWidth={1.75} aria-hidden="true" />
          {onlineCount > 0 ? (
            <span
              className="absolute bottom-1 right-1 size-1.5 rounded-full bg-emerald-500 ring-2 ring-background"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 overflow-hidden border-border/70 p-0"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold">Team</p>
            <p className="mb-0 mt-0.5 text-[11px] text-muted-foreground">
              {(members.length || space.member_count) + agents.length + 1} teammates in {space.name}
            </p>
          </div>
          {onlineCount > 0 ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{onlineCount} online</span>
          ) : null}
        </div>

        <div className="misty-transient-scrollbar max-h-[min(420px,65vh)] overflow-y-auto p-1.5">
          {loading && members.length === 0 ? (
            <MembersSkeleton />
          ) : (
            <TeamRows
              members={orderedMembers}
              agents={agents}
              onOpenAgent={(agentId) => {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("agentDock", "1");
                  next.set("agent", agentId);
                  return next;
                });
                setOpen(false);
              }}
            />
          )}
        </div>

        {space.role === "owner" || space.permissions?.["agents.manage"] === true ? (
          <div className="grid grid-cols-2 gap-1 border-t border-border/60 p-1.5">
            <Button
              asChild
              className="h-8 justify-start gap-2 px-2 text-xs"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <Link to={`${managePath}?invite=1`} state={settingsState}>
                <UserPlus size={14} />
                Invite
              </Link>
            </Button>
            <Button
              asChild
              className="h-8 justify-start gap-2 px-2 text-xs"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <Link to={managePath} state={settingsState}>
                <Settings2 size={14} />
                Manage
              </Link>
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function TeamRows({
  members,
  agents,
  onOpenAgent,
}: {
  members: PresentMember[];
  agents: SpaceAgentMembership[];
  onOpenAgent: (agentId: string) => void;
}) {
  return (
    <div className="grid gap-0.5">
      {members.map((member) => (
        <div
          className="flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/65"
          key={`person:${member.user_id}`}
        >
          <span className="relative inline-flex shrink-0">
            <Avatar className={cn("size-7", member.presenceStatus === "offline" && "opacity-55")}>
              <AvatarFallback className="text-[9px] font-semibold">
                {personInitials(member.name)}
              </AvatarFallback>
            </Avatar>
            <PresenceDot status={member.presenceStatus} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{member.name}</span>
          <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
            {member.role}
          </span>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-h-10 justify-start gap-2.5 rounded-md px-2 py-1.5 text-left"
        onClick={() => onOpenAgent("misty")}
      >
        <AgentAvatar
          name="Misty"
          avatar={{ kind: "preset", preset_id: "sparkles", accent: "violet" }}
          className="size-7"
          iconClassName="size-3.5"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">Misty</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">Agent · Ready</span>
      </Button>
      {agents.map((agent) => (
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-10 justify-start gap-2.5 rounded-md px-2 py-1.5 text-left"
          key={`agent:${agent.agent_id}`}
          onClick={() => onOpenAgent(agent.agent_id)}
        >
          <AgentAvatar
            agentId={agent.agent_id}
            avatar={agent.avatar}
            legacyIcon={agent.icon}
            name={agent.name}
            className="size-7"
            iconClassName="size-3.5"
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            Agent · {agentWorkStateLabel(agent)}
          </span>
        </Button>
      ))}
    </div>
  );
}

function agentWorkStateLabel(agent: SpaceAgentMembership): string {
  const state = agent.work_state || (agent.enabled ? "ready" : "disabled");
  return {
    ready: "Ready",
    working: "Working",
    needs_approval: "Needs approval",
    failed: "Failed",
    disabled: "Disabled",
    update_available: "Update available",
  }[state];
}

function PresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-popover",
        status === "online" && "bg-emerald-500",
        status === "idle" && "bg-amber-400",
        status === "offline" && "bg-muted-foreground/45",
      )}
      aria-hidden="true"
    />
  );
}

function MembersSkeleton() {
  return (
    <div className="grid gap-1 p-1" aria-label="Loading members" role="status">
      {[0, 1, 2, 3].map((index) => (
        <div className="flex min-h-10 items-center gap-2.5 px-1" key={index}>
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3 flex-1 rounded" />
        </div>
      ))}
    </div>
  );
}

function groupMembersByPresence(
  members: SpaceMember[],
  viewers: SpacePresenceViewer[],
  currentUserId?: string,
): Record<PresenceStatus, PresentMember[]> {
  const viewerById = new Map(viewers.map((viewer) => [viewer.user_id, viewer]));
  const grouped: Record<PresenceStatus, PresentMember[]> = {
    online: [],
    idle: [],
    offline: [],
  };

  members.forEach((member) => {
    const viewer = viewerById.get(member.user_id);
    const presenceStatus: PresenceStatus = viewer ? (viewer.active ? "online" : "idle") : "offline";
    grouped[presenceStatus].push({ ...member, presenceStatus });
  });

  Object.values(grouped).forEach((group) => {
    group.sort((left, right) => {
      if (left.user_id === currentUserId) return -1;
      if (right.user_id === currentUserId) return 1;
      return left.name.localeCompare(right.name);
    });
  });
  return grouped;
}
