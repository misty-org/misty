import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Avatar, AvatarFallback, Button } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { cn } from "@/ui";
import type { SpaceMember } from "@/models/interfaces/features/spaces/types";
import type { SpacePresenceViewer } from "@/models/types/stores/spaces/useSpacesBackendStore";
import { memberInitials } from "../SpaceTaskPrimitives";

const rotationIntervalMs = 4000;
const visibleCount = 3;

type PresentMember = SpaceMember & { active: boolean };

export function ActiveUsersCapsule({
  viewers,
  members,
  currentUserId,
}: {
  viewers: SpacePresenceViewer[];
  members: SpaceMember[];
  currentUserId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);

  const presentMembers = useMemo(() => {
    const byId = new Map(members.map((member) => [member.user_id, member]));
    return viewers
      .map((viewer): PresentMember | null => {
        const member = byId.get(viewer.user_id);
        return member ? { ...member, active: viewer.active } : null;
      })
      .filter((member): member is PresentMember => Boolean(member));
  }, [viewers, members]);

  // The tray rotates through people who actually have Misty in view. If
  // everyone connected happens to be idle, fall back to showing them anyway
  // (dimmed via the status dot) rather than rendering an empty button.
  const activeMembers = useMemo(
    () => presentMembers.filter((member) => member.active),
    [presentMembers],
  );
  const trayMembers = activeMembers.length > 0 ? activeMembers : presentMembers;
  const rotationNeeded = trayMembers.length > visibleCount;

  useEffect(() => {
    if (!rotationNeeded) {
      setOffset(0);
      return;
    }
    const timer = window.setInterval(() => {
      setOffset((current) => (current + 1) % trayMembers.length);
    }, rotationIntervalMs);
    return () => window.clearInterval(timer);
  }, [rotationNeeded, trayMembers.length]);

  if (presentMembers.length === 0) return null;

  const visible = rotationNeeded
    ? Array.from(
        { length: visibleCount },
        (_, index) => trayMembers[(offset + index) % trayMembers.length],
      )
    : trayMembers.slice(0, visibleCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-auto w-auto shrink-0 rounded-full border-border/60 bg-muted/40 p-1 hover:bg-muted/70"
          aria-label={`${presentMembers.length} people in this Space, click to see everyone`}
        >
          <span className="flex -space-x-2" aria-hidden="true">
            {visible.map((member, index) => (
              <PresenceAvatar
                key={member.user_id}
                member={member}
                highlight={member.user_id === currentUserId}
                style={{ zIndex: visible.length - index }}
              />
            ))}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <p className="mb-1 px-2 py-1 text-xs font-semibold text-muted-foreground">
          In this Space · {presentMembers.length}
        </p>
        <div className="misty-transient-scrollbar max-h-72 overflow-y-auto">
          {presentMembers.map((member) => (
            <div
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              key={member.user_id}
            >
              <PresenceAvatar member={member} className="size-7" />
              <span className="min-w-0 flex-1 truncate">
                {member.name}
                {member.user_id === currentUserId ? " (you)" : ""}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresenceAvatar({
  member,
  highlight,
  className,
  style,
}: {
  member: PresentMember;
  highlight?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className="relative inline-flex shrink-0" style={style}>
      <Avatar
        className={cn(
          "size-6 border-2 border-background transition-transform duration-500",
          highlight && "ring-1 ring-primary",
          className,
        )}
      >
        <AvatarFallback className="text-[9px] font-semibold">
          {memberInitials(member.name)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "absolute bottom-0 right-0 size-2 rounded-full border-2 border-background",
          member.active ? "bg-emerald-500" : "bg-muted-foreground/50",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
