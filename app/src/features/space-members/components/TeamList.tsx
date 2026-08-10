import { AgentAvatar } from "@/features/agents";
import { personInitials } from "@/shared/lib/personInitials";
import { spacesApi } from "@/services/spaces/api";
import type { SpaceAgentMembership, SpaceMember } from "@/services/spaces/dto/interfaces/types";
import type { MemberAction } from "@/services/spaces/dto/types/components/SpaceMembers";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import { errorText } from "@/shared/lib/format";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Skeleton,
  cn,
} from "@/shared/ui";
import { Ellipsis, Mail, Pencil, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
  canManageAgents,
  currentUserId,
  onMemberAction,
  onReload,
  onError,
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
  const [busy, setBusy] = useState("");
  const [roleAgent, setRoleAgent] = useState<SpaceAgentMembership | null>(null);
  const [roleDraft, setRoleDraft] = useState("");

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

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await operation();
      await onReload();
      onError("");
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const openAgent = (agentId: string) => {
    void spacesApi
      .directAgentConversation(spaceId, agentId)
      .then((conversation) =>
        navigate(
          `/spaces/${encodeURIComponent(spaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`,
        ),
      );
  };

  return (
    <>
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
                  canManageAgents={canManageAgents}
                  ownerName={memberNames.get(row.data.owner_user_id) || "external creator"}
                  onOpenAgent={openAgent}
                  onEditRole={() => {
                    setRoleAgent(row.data);
                    setRoleDraft(row.data.space_role || row.data.role || "");
                  }}
                  onApproveVersion={() =>
                    void run(`approve:${row.data.agent_id}`, () =>
                      spacesApi.approveSpaceAgentVersion(spaceId, row.data.agent_id),
                    )
                  }
                  onToggleEnabled={() =>
                    void run(`toggle:${row.data.agent_id}`, () =>
                      spacesApi.updateSpaceAgent(spaceId, row.data, {
                        enabled: !row.data.enabled,
                        space_role: row.data.space_role || "",
                        space_instructions: row.data.space_instructions || "",
                        permissions: row.data.permissions,
                      }),
                    )
                  }
                  onRemove={() =>
                    void run(`remove:${row.data.agent_id}`, () =>
                      spacesApi.removeSpaceAgent(spaceId, row.data.agent_id),
                    )
                  }
                />
              ),
            )
          : null}
      </Card>

      <Dialog open={roleAgent !== null} onOpenChange={(open) => !open && setRoleAgent(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Space role</DialogTitle>
            <DialogDescription>This public role applies only in this Space.</DialogDescription>
          </DialogHeader>
          <Input
            value={roleDraft}
            maxLength={80}
            onChange={(event) => setRoleDraft(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleAgent(null)}>
              Cancel
            </Button>
            <Button
              disabled={!roleAgent || Boolean(busy)}
              onClick={() => {
                if (!roleAgent) return;
                void run(`role:${roleAgent.agent_id}`, () =>
                  spacesApi.updateSpaceAgent(spaceId, roleAgent, {
                    enabled: roleAgent.enabled,
                    space_role: roleDraft.trim(),
                    space_instructions: roleAgent.space_instructions || "",
                    permissions: roleAgent.permissions,
                  }),
                ).then(() => setRoleAgent(null));
              }}
            >
              Save role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  canManageAgents,
  ownerName,
  onOpenAgent,
  onEditRole,
  onApproveVersion,
  onToggleEnabled,
  onRemove,
}: {
  agent: SpaceAgentMembership;
  bordered: boolean;
  canManageAgents: boolean;
  ownerName: string;
  onOpenAgent: (agentId: string) => void;
  onEditRole: () => void;
  onApproveVersion: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
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
          {agent.space_role || agent.role || "AI teammate"} · owner {ownerName}
        </p>
      </div>
      <WorkStateBadge state={agent.work_state || (agent.enabled ? "ready" : "disabled")} />
      {canManageAgents ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={`Manage ${agent.name}`}>
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEditRole}>
              <Pencil className="mr-2 size-4" /> Edit Space role
            </DropdownMenuItem>
            {agent.update_available ? (
              <DropdownMenuItem onSelect={onApproveVersion}>
                <RefreshCw className="mr-2 size-4" /> Approve version {agent.latest_version}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onToggleEnabled}>
              {agent.enabled ? "Disable Agent" : "Enable Agent"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-cream-bright focus:text-cream-bright"
              onSelect={onRemove}
            >
              <Trash2 className="mr-2 size-4" /> Remove from Space
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function WorkStateBadge({ state }: { state: NonNullable<SpaceAgentMembership["work_state"]> }) {
  const labels = {
    ready: "Ready",
    queued: "Queued",
    working: "Working",
    awaiting_approval: "Awaiting approval",
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
