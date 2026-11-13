import { personInitials } from "@/shared/lib/personInitials";
import type { SpaceMember } from "../../api/dto/entities";
import type { SpaceAgent } from "@/features/agents";
import type { ItemVisibility } from "../../api/visibility";
import { SpaceAgentRow } from "../agents/SpaceAgentRow";
import { agentsByOwner } from "../agents/useSpaceAgentMembers";
import type { MemberAction } from "./SpaceMembers";
import { useMemberPicture } from "../memberPictures";

/** A member's own profile picture, over their initials while it loads or when they have none. */
function MemberPicture({ member }: { member: SpaceMember }) {
  const url = useMemberPicture(member.space_id, member.user_id, member.avatar_version);
  return url ? <AvatarImage src={url} alt="" /> : null;
}
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Card,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  OverflowFadeText,
  PlaceholderIcon,
  Skeleton,
  Text,
} from "@/shared/ui";
import { Ellipsis, Mail, ShieldCheck, Trash2, Users } from "lucide-react";

const rowClass = "flex min-h-18 min-w-0 items-center gap-3 px-4 py-3";

/** Each person in the Space, with the agents they brought under them. */
export function MemberList({
  members,
  agents,
  loading,
  expectedCount,
  owner,
  canTransferOwnership,
  currentUserId,
  onAction,
  onRemoveAgent,
  onAgentVisibility,
}: {
  members: SpaceMember[];
  agents: SpaceAgent[] | undefined;
  loading: boolean;
  /** How many people the Space says it has, so its first load draws that many rows. */
  expectedCount?: number;
  owner: boolean;
  canTransferOwnership: boolean;
  currentUserId: string | undefined;
  onAction: (action: MemberAction) => void;
  onRemoveAgent: (agentId: string) => void;
  onAgentVisibility: (agentId: string, visibility: ItemVisibility) => void;
}) {
  const byOwner = agentsByOwner(agents);
  return (
    <Card className="overflow-hidden" aria-label="Space members">
      {loading ? (
        <MemberListSkeleton rows={Math.min(Math.max(expectedCount ?? 4, 1), 8)} />
      ) : (
        members.map((member, index) => (
          <div className={index ? "border-t" : ""} key={member.user_id}>
            <div className={`group ${rowClass}`}>
              <Avatar className="size-10 shrink-0">
                <MemberPicture member={member} />
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
                  <Text as="p" full tone="default" className="m-0 text-sm font-medium">
                    {member.name}
                  </Text>
                  {member.user_id === currentUserId ? <Badge variant="secondary">You</Badge> : null}
                </div>
                <Text
                  bare
                  as="p"
                  tone="muted"
                  className="mb-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-xs"
                >
                  <Mail className="shrink-0" />
                  <OverflowFadeText full>{member.email}</OverflowFadeText>
                </Text>
              </div>
              <Badge className="hidden capitalize sm:inline-flex" variant="outline">
                {member.role}
              </Badge>
              {owner && member.role !== "owner" ? (
                <div className="flex shrink-0 items-center gap-1">
                  <MemberActionsMenu
                    member={member}
                    canTransferOwnership={canTransferOwnership}
                    onAction={onAction}
                  />
                </div>
              ) : null}
            </div>
            {(byOwner.get(member.user_id) ?? []).map((agent) => (
              <SpaceAgentRow
                key={agent.agent_id}
                agent={agent}
                onRemove={
                  owner || agent.owner_user_id === currentUserId
                    ? () => onRemoveAgent(agent.agent_id)
                    : undefined
                }
                onVisibilityChange={
                  agent.owner_user_id === currentUserId
                    ? (visibility) => onAgentVisibility(agent.agent_id, visibility)
                    : undefined
                }
              />
            ))}
          </div>
        ))
      )}
      {!loading && !members.length ? <MemberListEmpty /> : null}
    </Card>
  );
}

function MemberActionsMenu({
  member,
  canTransferOwnership,
  onAction,
}: {
  member: SpaceMember;
  canTransferOwnership: boolean;
  onAction: (action: MemberAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${member.name}`}>
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canTransferOwnership ? (
          <>
            <MenuItem
              icon={<ShieldCheck />}
              label="Transfer ownership"
              onSelect={() => onAction({ kind: "transfer", member })}
            />
            <DropdownMenuSeparator />
          </>
        ) : null}
        <MenuItem
          icon={<Trash2 />}
          label="Remove member"
          danger
          onSelect={() => onAction({ kind: "remove", member })}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Member rows while the list first loads: the avatar, name and email, and the role badge. */
function MemberListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading members</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className={`${rowClass} ${index ? "border-t" : ""}`} key={index}>
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-3 w-44 rounded" />
          </div>
          <Skeleton className="hidden h-5 w-14 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  );
}

function MemberListEmpty() {
  return (
    <div className="grid min-h-56 place-items-center p-6 text-center">
      <div>
        <PlaceholderIcon icon={Users} className="mx-auto" />
        <p className="mb-0 mt-3 text-sm font-medium">No members loaded</p>
        <Text tone="muted" wrap className="mb-0 mt-1 text-xs">
          Members will appear when access data is available.
        </Text>
      </div>
    </div>
  );
}
