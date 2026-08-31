import { personInitials } from "@/shared/lib/personInitials";
import type { SpaceMember } from "@/api/spaces/dto/interfaces/types";
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
import { Ellipsis, Mail, ShieldCheck, Trash2, Users } from "lucide-react";
import { MemberPermissionControls } from "./MemberPermissionControls";

const rowClass = "flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3";

export function MemberList({
  members,
  loading,
  owner,
  currentUserId,
  onAction,
}: {
  members: SpaceMember[];
  loading: boolean;
  owner: boolean;
  currentUserId: string | undefined;
  onAction: (action: MemberAction) => void;
}) {
  return (
    <Card className="overflow-hidden" aria-label="Space members">
      {loading ? (
        <MemberListSkeleton />
      ) : (
        members.map((member, index) => (
          <div
            className={`group ${rowClass} transition-colors hover:bg-charcoal-card ${index ? "border-t border-charcoal-border/60" : ""}`}
            key={member.user_id}
          >
            <Avatar className="size-10 shrink-0">
              <AvatarFallback
                className={cn(
                  "text-xs font-semibold",
                  avatarColorClass(member.user_id),
                  avatarInkClass,
                )}
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
                <MemberActionsMenu member={member} onAction={onAction} />
              </div>
            ) : null}
          </div>
        ))
      )}
      {!loading && !members.length ? <MemberListEmpty /> : null}
    </Card>
  );
}

function MemberActionsMenu({
  member,
  onAction,
}: {
  member: SpaceMember;
  onAction: (action: MemberAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" type="button" aria-label={`Actions for ${member.name}`}>
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction({ kind: "transfer", member })}>
          <ShieldCheck className="mr-2 size-4" /> Transfer ownership
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-cream-bright focus:text-cream-bright"
          onSelect={() => onAction({ kind: "remove", member })}
        >
          <Trash2 className="mr-2 size-4" /> Remove member
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberListSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading members</span>
      {[0, 1, 2, 3].map((index) => (
        <div
          className={`${rowClass} ${index ? "border-t border-charcoal-border/60" : ""}`}
          key={index}
        >
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-3 w-44 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MemberListEmpty() {
  return (
    <div className="grid min-h-56 place-items-center p-6 text-center">
      <div>
        <Users className="mx-auto size-6 text-cream-muted" />
        <p className="mb-0 mt-3 text-sm font-medium">No members loaded</p>
        <p className="mb-0 mt-1 text-xs text-cream-muted">
          Members will appear when access data is available.
        </p>
      </div>
    </div>
  );
}
