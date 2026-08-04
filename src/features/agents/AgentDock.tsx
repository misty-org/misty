import { useEffect, useMemo, useState } from "react";
import { Plus, UserPlus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { AgentWorkspace } from "@/pages/Agents/desktop";
import { agentArchitectureApi } from "@/stores/agents/useAgentArchitectureStore";
import { usePersonalAgentsStore } from "@/stores/agents/usePersonalAgentsStore";
import { useAgentSessionStore } from "@/stores/agent/useAgentSessionStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceAgentMembership } from "@/models/interfaces/features/spaces/types";
import { AgentAvatar } from "@/features/agents/AgentAvatar";
import { AgentCreatorDialog } from "@/features/agents/AgentCreatorDialog";
import { analytics } from "@/analytics/client";
import { AgentAboutView, AgentWorkView, DockEmpty, type AgentDockAgent } from "./AgentDockViews";
import {
  agentDockSelectionStorageKey,
  agentServerSpaceSection,
  agentStarterPrompts,
  agentTaskDockPath,
  resolveSelectedAgent,
  type AgentDockContext,
} from "./agentDockState";
import { useAgentDockDetails } from "./useAgentDockDetails";

const emptyMemberships: SpaceAgentMembership[] = [];

export function AgentDock({
  context,
  onClose,
}: {
  context: AgentDockContext;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSelectedAgentId = searchParams.get("agent") ?? "";
  const personalAgents = usePersonalAgentsStore((state) => state.agents);
  const personalAgentsLoaded = usePersonalAgentsStore((state) => state.loaded);
  const loadPersonalAgents = usePersonalAgentsStore((state) => state.load);
  const memberships = useSpacesStore(
    (state) =>
      (context.spaceId ? state.agentMembershipsBySpace[context.spaceId] : undefined) ??
      emptyMemberships,
  );
  const loadMembers = useSpacesStore((state) => state.loadMembers);
  const { running, conversations, actionPlans, toolApprovals, startNewConversation } =
    useAgentSessionStore(
      useShallow((state) => ({
        running: Boolean(state.status?.running),
        conversations: state.conversations,
        actionPlans: state.actionPlans,
        toolApprovals: state.toolApprovals,
        startNewConversation: state.startNewConversation,
      })),
    );
  const [tab, setTab] = useState("chat");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const selectionStorageKey = user?.id
    ? agentDockSelectionStorageKey(user.id, context.spaceId || "files")
    : "";
  const persistedAgentId = useMemo(() => {
    if (!selectionStorageKey) return "";
    try {
      return localStorage.getItem(selectionStorageKey) ?? "";
    } catch {
      return "";
    }
  }, [selectionStorageKey]);
  const selectedAgentId = urlSelectedAgentId || persistedAgentId;

  const agents = useMemo<AgentDockAgent[]>(() => {
    if (context.surface === "space") {
      return [
        {
          id: "misty",
          name: "Misty",
          role: "Team coordinator",
          description: "Understands this Space and routes work to the right teammate.",
          icon: "sparkles",
          coordinator: true,
        },
        ...memberships
          .filter((membership) => membership.enabled)
          .map((membership) => ({
            id: membership.agent_id,
            name: membership.name,
            role: membership.space_role || membership.role || "AI teammate",
            description: membership.description,
            icon: membership.icon,
            avatar: membership.avatar,
            membership,
          })),
      ];
    }
    return personalAgents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role || "AI teammate",
        description: agent.description,
        icon: agent.icon,
        avatar: agent.avatar,
        personal: agent,
      }));
  }, [context.surface, memberships, personalAgents]);

  const selectedAgent = resolveSelectedAgent(agents, selectedAgentId);
  const detailAgentId = selectedAgent?.id ?? "";
  const detailAgentCoordinator = Boolean(selectedAgent?.coordinator);
  const detailAgentCanLoadPersonalToolbox = Boolean(
    selectedAgent?.personal || selectedAgent?.membership?.owner_user_id === user?.id,
  );
  const {
    runs,
    runDetails,
    toolbox,
    availableContext,
    loading: detailLoading,
    actingRunId,
    actionError: runActionError,
    runAction,
  } = useAgentDockDetails({
    spaceId: context.spaceId,
    surface: context.surface,
    agentId: detailAgentId,
    coordinator: detailAgentCoordinator,
    canLoadPersonalToolbox: detailAgentCanLoadPersonalToolbox,
    loadMembers,
  });
  const pendingApprovals =
    toolApprovals.filter((approval) => !approval.completed && !approval.error).length +
    actionPlans.filter((plan) => plan.status === "pending").length;
  const attentionCount = pendingApprovals + (selectedAgent?.membership?.attention_count ?? 0);

  useEffect(() => {
    analytics.track("agent_dock_opened", {
      surface: context.surface,
      context_kind: context.taskId
        ? "task"
        : context.selectedPaths?.length
          ? "selection"
          : "surface",
    });
  }, [context.selectedPaths?.length, context.surface, context.taskId]);

  useEffect(() => {
    if (context.surface === "files") void loadPersonalAgents();
    else if (context.spaceId) void loadMembers(context.spaceId).catch(() => undefined);
  }, [context.spaceId, context.surface, loadMembers, loadPersonalAgents, user?.id]);

  useEffect(() => {
    const loaded =
      context.surface === "files"
        ? personalAgentsLoaded
        : Boolean(
            context.spaceId &&
            Object.prototype.hasOwnProperty.call(
              useSpacesStore.getState().agentMembershipsBySpace,
              context.spaceId,
            ),
          );
    if (!loaded) return;
    const nextAgentId = agents.some((agent) => agent.id === selectedAgentId)
      ? selectedAgentId
      : (agents[0]?.id ?? "");
    if (selectionStorageKey) {
      try {
        if (nextAgentId) localStorage.setItem(selectionStorageKey, nextAgentId);
        else localStorage.removeItem(selectionStorageKey);
      } catch {}
    }
    if (urlSelectedAgentId === nextAgentId) return;
    const next = new URLSearchParams(searchParams);
    if (nextAgentId) next.set("agent", nextAgentId);
    else next.delete("agent");
    next.set("agentDock", "1");
    setSearchParams(next, { replace: true });
  }, [
    agents,
    context.spaceId,
    context.surface,
    personalAgentsLoaded,
    searchParams,
    selectedAgentId,
    selectionStorageKey,
    setSearchParams,
    urlSelectedAgentId,
  ]);

  useEffect(() => {
    if (!selectedAgent || selectedAgent.id === selectedAgentId) return;
    const next = new URLSearchParams(searchParams);
    next.set("agent", selectedAgent.id);
    next.set("agentDock", "1");
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedAgent, selectedAgentId, setSearchParams]);

  const chooseAgent = (agentId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("agent", agentId);
    next.set("agentDock", "1");
    next.delete("model");
    setSearchParams(next);
  };

  const starterPrompts = useMemo(
    () => agentStarterPrompts(context, Boolean(selectedAgent?.coordinator)),
    [context, selectedAgent?.coordinator],
  );

  return (
    <>
      <section
        className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-background"
        aria-label="Agent teammates"
      >
        <header className="grid gap-2 border-b border-border/60 px-3 pb-3 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative shrink-0">
              <AgentAvatar
                agentId={selectedAgent?.coordinator ? undefined : selectedAgent?.id}
                avatar={
                  selectedAgent?.coordinator
                    ? { kind: "preset", preset_id: "sparkles", accent: "violet" }
                    : selectedAgent?.avatar
                }
                legacyIcon={selectedAgent?.icon}
                name={selectedAgent?.name ?? "Agent"}
              />
              {running ? (
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500"
                  aria-label="Working"
                />
              ) : null}
            </span>
            <Select value={selectedAgent?.id ?? ""} onValueChange={chooseAgent}>
              <SelectTrigger className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none">
                <SelectValue placeholder="Choose an Agent" />
              </SelectTrigger>
              <SelectContent align="start">
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.coordinator ? " · Coordinator" : " · Agent"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              type="button"
              title="Create Agent teammate"
              aria-label="Create Agent teammate"
              onClick={() => setCreatorOpen(true)}
            >
              <UserPlus size={15} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              type="button"
              title="New private chat"
              aria-label="New private Agent chat"
              disabled={!selectedAgent}
              onClick={() => void startNewConversation()}
            >
              <Plus size={15} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              type="button"
              title="Close Agents"
              aria-label="Close Agents"
              onClick={onClose}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="outline" className="max-w-full truncate font-normal">
              {context.label}
            </Badge>
            {attentionCount ? (
              <Badge variant="destructive" className="shrink-0">
                {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
              </Badge>
            ) : null}
          </div>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="contents">
          <TabsList className="mx-3 mt-2 grid h-9 grid-cols-3">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="work">Work</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="min-h-0 overflow-hidden">
            {selectedAgent ? (
              <AgentWorkspace
                embedded
                hideHeader
                spaceId={context.spaceId}
                contextLabel={context.label}
                spaceSection={agentServerSpaceSection(context.section)}
                taskId={context.taskId}
                cwd={context.cwd}
                selectedPaths={context.selectedPaths}
                draftPrompt={draftPrompt}
                onDraftConsumed={() => setDraftPrompt("")}
              />
            ) : (
              <DockEmpty
                title="No Agents yet"
                description="Create an Agent to bring a specialized teammate into your work."
              />
            )}
          </TabsContent>

          <TabsContent value="work" className="min-h-0 overflow-hidden">
            <AgentWorkView
              agent={selectedAgent}
              runs={runs}
              conversations={conversations}
              running={running}
              loading={detailLoading}
              details={runDetails}
              actingRunId={actingRunId}
              actionError={runActionError}
              onDecide={(runId, approved) =>
                void runAction(runId, () => agentArchitectureApi.decideRun(runId, approved))
              }
              onRetry={(runId) => void runAction(runId, () => agentArchitectureApi.retryRun(runId))}
              onCancel={(runId) =>
                void runAction(runId, () => agentArchitectureApi.cancelRun(runId))
              }
              onOpenTask={
                context.spaceId
                  ? (taskId) =>
                      navigate(
                        agentTaskDockPath(context.spaceId!, taskId, selectedAgent?.id ?? "misty"),
                      )
                  : undefined
              }
            />
          </TabsContent>

          <TabsContent value="about" className="min-h-0 overflow-hidden">
            <AgentAboutView
              agent={selectedAgent}
              toolbox={toolbox}
              availableContext={availableContext}
              loading={detailLoading}
              starterPrompts={starterPrompts}
              onUseStarter={(nextPrompt) => {
                setDraftPrompt(nextPrompt);
                setTab("chat");
              }}
              onCreateAgent={() => setCreatorOpen(true)}
              onManageAgents={
                context.spaceId
                  ? () =>
                      navigate(
                        `/spaces/${encodeURIComponent(context.spaceId ?? "")}/settings/members?agentDock=1`,
                      )
                  : undefined
              }
            />
          </TabsContent>
        </Tabs>
      </section>
      <AgentCreatorDialog
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        defaultSpaceId={context.spaceId}
        onCreated={(agentId) => {
          if (!context.spaceId) {
            chooseAgent(agentId);
            return;
          }
          void loadMembers(context.spaceId)
            .catch(() => undefined)
            .finally(() => chooseAgent(agentId));
        }}
      />
    </>
  );
}
