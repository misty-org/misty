import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Ellipsis,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/ui";
import type { MemberAction } from "@/models/types/features/spaces/components/SpaceMembers";
import type { SpaceAgentMembership, SpaceMember } from "@/models/interfaces/features/spaces/types";
import { AgentAvatar } from "@/features/agents/AgentAvatar";
import { AgentCreatorDialog } from "@/features/agents/AgentCreatorDialog";
import { errorText } from "@/lib/format";
import { usePersonalAgentsStore } from "@/stores/agents/usePersonalAgentsStore";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { MemberPermissionControls } from "./MemberPermissionControls";
import { personInitials } from "../personInitials";

const rowClass = "flex min-h-[72px] min-w-0 items-center gap-3 px-4 py-3";

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
  const [, setSearchParams] = useSearchParams();
  const personalAgents = usePersonalAgentsStore((state) => state.agents);
  const loadPersonalAgents = usePersonalAgentsStore((state) => state.load);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [busy, setBusy] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [roleAgent, setRoleAgent] = useState<SpaceAgentMembership | null>(null);
  const [roleDraft, setRoleDraft] = useState("");

  useEffect(() => {
    if (canManageAgents) void loadPersonalAgents();
  }, [canManageAgents, loadPersonalAgents]);

  const available = useMemo(() => {
    const installed = new Set(agents.map((agent) => agent.agent_id));
    return personalAgents.filter((agent) => agent.enabled && !installed.has(agent.id));
  }, [agents, personalAgents]);
  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name])),
    [members],
  );

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
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("agentDock", "1");
      next.set("agent", agentId);
      return next;
    });
  };

  return (
    <>
      <Card className="overflow-hidden" aria-label="Space team">
        {canManageAgents ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
            <div>
              <p className="m-0 text-sm font-medium">Agent teammates</p>
              <p className="mb-0 mt-0.5 text-xs text-muted-foreground">
                Hire an existing Agent or create a specialized coworker.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {available.length ? (
                <>
                  <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                    <SelectTrigger className="h-8 w-44" aria-label="Choose an Agent">
                      <SelectValue placeholder="Choose Agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!selectedAgentId || Boolean(busy)}
                    onClick={() =>
                      void run("add", async () => {
                        const selected = personalAgents.find(
                          (agent) => agent.id === selectedAgentId,
                        );
                        await spacesApi.addSpaceAgent(
                          spaceId,
                          selectedAgentId,
                          selected?.role ?? "",
                        );
                        setSelectedAgentId("");
                      })
                    }
                  >
                    {busy === "add" ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Hire
                  </Button>
                </>
              ) : null}
              <Button size="sm" onClick={() => setCreatorOpen(true)}>
                <Plus className="size-4" /> Create Agent
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? <TeamSkeleton /> : null}
        {!loading
          ? members.map((member, index) => (
              <div
                className={`group ${rowClass} transition-colors hover:bg-muted/50 ${index ? "border-t border-border/60" : ""}`}
                key={`person:${member.user_id}`}
              >
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="text-xs font-semibold">
                    {personInitials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="m-0 truncate text-sm font-medium text-foreground">
                      {member.name}
                    </p>
                    {member.user_id === currentUserId ? (
                      <Badge variant="secondary">You</Badge>
                    ) : null}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Actions for ${member.name}`}
                        >
                          <Ellipsis className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => onMemberAction({ kind: "transfer", member })}
                        >
                          <ShieldCheck className="mr-2 size-4" /> Transfer ownership
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => onMemberAction({ kind: "remove", member })}
                        >
                          <Trash2 className="mr-2 size-4" /> Remove member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            ))
          : null}

        {!loading ? (
          <div className={`${rowClass} border-t border-border/60 bg-violet-500/[0.03]`}>
            <AgentAvatar
              name="Misty"
              avatar={{ kind: "preset", preset_id: "sparkles", accent: "violet" }}
              className="size-10"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-w-0 truncate p-0 text-left text-sm font-medium"
                  onClick={() => openAgent("misty")}
                >
                  Misty
                </Button>
                <Badge variant="secondary">Agent</Badge>
              </div>
              <p className="mb-0 mt-0.5 truncate text-xs text-muted-foreground">
                Team coordinator · managed by Misty
              </p>
            </div>
            <WorkStateBadge state="ready" />
          </div>
        ) : null}

        {!loading
          ? agents.map((agent) => (
              <div
                key={`agent:${agent.agent_id}`}
                className={`${rowClass} border-t border-border/60 transition-colors hover:bg-muted/50`}
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
                      onClick={() => openAgent(agent.agent_id)}
                    >
                      {agent.name}
                    </Button>
                    <Badge variant="secondary">Agent</Badge>
                    {(agent.attention_count ?? 0) > 0 ? (
                      <Badge variant="destructive">{agent.attention_count}</Badge>
                    ) : null}
                  </div>
                  <p className="mb-0 mt-0.5 truncate text-xs text-muted-foreground">
                    {agent.space_role || agent.role || "AI teammate"} · owner{" "}
                    {memberNames.get(agent.owner_user_id) || "external creator"}
                  </p>
                </div>
                <WorkStateBadge
                  state={agent.work_state || (agent.enabled ? "ready" : "disabled")}
                />
                {canManageAgents ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`Manage ${agent.name}`}>
                        <Ellipsis className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          setRoleAgent(agent);
                          setRoleDraft(agent.space_role || agent.role || "");
                        }}
                      >
                        <Pencil className="mr-2 size-4" /> Edit Space role
                      </DropdownMenuItem>
                      {agent.update_available ? (
                        <DropdownMenuItem
                          onSelect={() =>
                            void run(`approve:${agent.agent_id}`, () =>
                              spacesApi.approveSpaceAgentVersion(spaceId, agent.agent_id),
                            )
                          }
                        >
                          <RefreshCw className="mr-2 size-4" /> Approve version{" "}
                          {agent.latest_version}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        onSelect={() =>
                          void run(`toggle:${agent.agent_id}`, () =>
                            spacesApi.updateSpaceAgent(spaceId, agent, {
                              enabled: !agent.enabled,
                              space_role: agent.space_role || "",
                              space_instructions: agent.space_instructions || "",
                              permissions: agent.permissions,
                            }),
                          )
                        }
                      >
                        {agent.enabled ? "Disable Agent" : "Enable Agent"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() =>
                          void run(`remove:${agent.agent_id}`, () =>
                            spacesApi.removeSpaceAgent(spaceId, agent.agent_id),
                          )
                        }
                      >
                        <Trash2 className="mr-2 size-4" /> Remove from Space
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ))
          : null}
      </Card>

      <AgentCreatorDialog
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        defaultSpaceId={spaceId}
        onCreated={() => void onReload()}
      />
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

function WorkStateBadge({ state }: { state: NonNullable<SpaceAgentMembership["work_state"]> }) {
  const labels = {
    ready: "Ready",
    working: "Working",
    needs_approval: "Needs approval",
    failed: "Failed",
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
