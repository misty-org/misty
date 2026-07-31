import { Ellipsis, Mail, ShieldCheck, Trash2, Users } from "lucide-react";
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
} from "@/ui";
import type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";
import type { SpaceMember } from "@/models/interfaces/features/spaces/types";
import { MemberPermissionControls } from "./MemberPermissionControls";
import { personInitials } from "../personInitials";

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
            className={`group ${rowClass} transition-colors hover:bg-muted/50 ${index ? "border-t border-border/60" : ""}`}
            key={member.user_id}
          >
            <Avatar className="size-10 shrink-0">
              <AvatarFallback className="text-xs font-semibold">
                {personInitials(member.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="m-0 truncate text-sm font-medium text-foreground">{member.name}</p>
                {member.user_id === currentUserId ? <Badge variant="secondary">You</Badge> : null}
              </div>
              <p className="mb-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
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
          className="text-destructive focus:text-destructive"
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
        <div className={`${rowClass} ${index ? "border-t border-border/60" : ""}`} key={index}>
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
        <Users className="mx-auto size-6 text-muted-foreground" />
        <p className="mb-0 mt-3 text-sm font-medium">No members loaded</p>
        <p className="mb-0 mt-1 text-xs text-muted-foreground">
          Members will appear when access data is available.
        </p>
      </div>
    </div>
  );
}
