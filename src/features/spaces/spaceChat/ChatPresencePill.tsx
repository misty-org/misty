import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarFallback, Button, Popover, PopoverContent, PopoverTrigger, cn } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceMember } from "@/models/interfaces/features/spaces/types";
import type { SpacePresenceViewer } from "@/models/types/stores/spaces/useSpacesBackendStore";
import { personInitials } from "../personInitials";

const emptyMembers: SpaceMember[] = [];
const emptyViewers: SpacePresenceViewer[] = [];

export function ChatPresencePill({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const { members, viewers, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      members: state.membersBySpace[spaceId] ?? emptyMembers,
      viewers: state.presenceBySpace[spaceId] ?? emptyViewers,
      loadMembers: state.loadMembers,
    })),
  );

  useEffect(() => {
    void loadMembers(spaceId).catch(() => undefined);
  }, [loadMembers, spaceId]);

  const activeMembers = useMemo(() => {
    const list: Array<{ user_id: string; name: string }> = [];
    const seen = new Set<string>();

    for (const v of viewers) {
      if (v.user_id && !seen.has(v.user_id)) {
        seen.add(v.user_id);
        const found = members.find((m) => m.user_id === v.user_id);
        list.push({
          user_id: v.user_id,
          name: found?.name || "Member",
        });
      }
    }

    if (user && !seen.has(user.id)) {
      list.push({
        user_id: user.id,
        name: user.name || "You",
      });
    }

    return list;
  }, [members, user, viewers]);

  if (activeMembers.length === 0) return null;

  const displayMembers = activeMembers.slice(0, 4);
  const overflowCount = activeMembers.length - displayMembers.length;

  const pillClass = cn(
    "flex h-7 items-center gap-1.5 rounded-full border border-charcoal-border/60",
    "bg-charcoal-card px-2 py-0.5 text-xs text-cream-muted transition-colors",
    "hover:bg-charcoal-hover hover:text-cream-bright focus:outline-none",
    open && "bg-charcoal-hover text-cream-bright border-charcoal-border",
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={pillClass}
          title={`${activeMembers.length} active member${activeMembers.length > 1 ? "s" : ""}`}
        >
          <div className="flex -space-x-2 overflow-hidden">
            {displayMembers.map((member) => (
              <Avatar
                key={member.user_id}
                className="size-5 border border-charcoal-card ring-1 ring-charcoal-bg"
              >
                <AvatarFallback className="bg-charcoal-active text-[9px] font-semibold text-cream">
                  {personInitials(member.name)}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          {overflowCount > 0 ? (
            <span className="text-[10px] font-medium text-cream-muted">+{overflowCount}</span>
          ) : null}
          <span className="size-1.5 rounded-full bg-status-green" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-48 overflow-hidden rounded-lg border border-charcoal-border/70 bg-charcoal-card p-1 shadow-md"
      >
        <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
          Active now ({activeMembers.length})
        </div>
        <div className="grid gap-0.5">
          {activeMembers.map((member) => (
            <div
              key={member.user_id}
              className="flex items-center gap-2 rounded px-2 py-1 text-xs text-cream-bright hover:bg-charcoal-hover"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-status-green" />
              <span className="truncate font-medium">
                {member.user_id === user?.id ? `${member.name} (You)` : member.name}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
