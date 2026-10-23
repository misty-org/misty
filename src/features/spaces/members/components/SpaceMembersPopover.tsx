import { useAuth } from "@/features/auth";
import { personInitials } from "@/shared/lib/personInitials";
import type { SpacePresenceViewer } from "@/features/spaces";
import { useSpacesStore } from "@/features/spaces";
import type { Space, SpaceMember } from "@/api/spaces/dto/entities";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import {
  Avatar,
  AvatarFallback,
  Button,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@/shared/ui";
import { Settings, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { SpaceAgentRow } from "../agents/SpaceAgentRow";
import { agentsByOwner, useSpaceAgentMembers } from "../agents/useSpaceAgentMembers";
import type { SpaceAgent } from "@/api/spaces/space-agents";

const emptyMembers: SpaceMember[] = [];
const emptyViewers: SpacePresenceViewer[] = [];

type PresenceStatus = "online" | "idle" | "offline";
type PresentMember = SpaceMember & { presenceStatus: PresenceStatus };

export function SpaceMembersPopover({
  space,
  trigger,
  side,
  align,
  onManage,
}: {
  space: Space;
  trigger?: ReactElement;
  side?: "bottom" | "right";
  align?: "start" | "center" | "end";
  /** Opens the People window: to invite someone, or to manage who is in the Space. */
  onManage: (invite: boolean) => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { members, viewers, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[space.id] ?? emptyMembers,
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

  // Agents load when the popover opens; an empty id keeps the hook idle.
  const { agents } = useSpaceAgentMembers(open ? space.id : "");

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <IconButton
            label="Space team"
            className={cn("relative", "", open && "text-cream-bright")}
            title="Team"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <UsersRound size={16} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        )}
      </PopoverTrigger>

      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-16px)] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b border-charcoal-border/60 px-2 py-2.5">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold">Team</p>
            <p className="mb-0 mt-0.5 text-[11px] text-cream-muted">
              {members.length || space.member_count} teammates
              {agents?.length
                ? ` and ${agents.length} agent${agents.length === 1 ? "" : "s"}`
                : ""}{" "}
              in {space.name}
            </p>
          </div>
          {onlineCount > 0 ? (
            <span className="shrink-0 text-[11px] text-cream-muted">{onlineCount} online</span>
          ) : null}
        </div>

        <div className="misty-transient-scrollbar max-h-[min(420px,65vh)] overflow-y-auto px-1 py-1.5">
          {loading && members.length === 0 ? (
            <MembersSkeleton />
          ) : (
            <>
              <TeamRows members={orderedMembers} agents={agents} />
            </>
          )}
        </div>

        {space.role === "owner" ? (
          <div className="grid grid-cols-2 gap-1 border-t border-charcoal-border/60 px-1 py-1.5">
            <Button
              className="h-8 justify-start gap-2 px-1.5 text-xs"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                onManage(true);
              }}
            >
              <UserPlus size={14} />
              Invite
            </Button>
            <Button
              className="h-8 justify-start gap-2 px-1.5 text-xs"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                onManage(false);
              }}
            >
              <Settings size={14} />
              Manage
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** People, each with the agents they brought under them. Agents have no presence. */
function TeamRows({ members, agents }: { members: PresentMember[]; agents?: SpaceAgent[] }) {
  const byOwner = agentsByOwner(agents);
  return (
    <div className="grid gap-0.5">
      {members.map((member) => (
        <div key={`person:${member.user_id}`}>
          <div className="flex min-h-9 items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-charcoal-hover">
            <span className="relative inline-flex shrink-0">
              <Avatar className={cn("size-7", member.presenceStatus === "offline" && "opacity-55")}>
                <AvatarFallback
                  className={cn(
                    "text-[9px] font-semibold",
                    avatarColorClass(member.user_id),
                    avatarInkClass,
                  )}
                >
                  {personInitials(member.name)}
                </AvatarFallback>
              </Avatar>
              <PresenceDot status={member.presenceStatus} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{member.name}</span>
            <span className="shrink-0 text-[10px] capitalize text-cream-muted">{member.role}</span>
          </div>
          {(byOwner.get(member.user_id) ?? []).map((agent) => (
            <SpaceAgentRow key={agent.agent_id} agent={agent} compact />
          ))}
        </div>
      ))}
    </div>
  );
}

function PresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-charcoal-border",
        status === "online" && "bg-cream-bright",
        status === "idle" && "bg-cream-muted",
        status === "offline" && "bg-charcoal-hover",
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
