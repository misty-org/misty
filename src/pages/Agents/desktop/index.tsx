import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Bot, Sparkles } from "lucide-react";
import { Progress } from "@/ui";
import { Textarea } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import {
  agentScopeKey,
  spaceAgentScopeKey,
  useAgentSessionStore,
} from "@/stores/agent/useAgentSessionStore";
import { usePersonalAgentsStore } from "@/stores/agents/usePersonalAgentsStore";
import { useAuth } from "@/features/auth/AuthContext";
import { AgentMessage } from "@/features/explorer/desktop/ExplorerAgentMessage";
import { AgentComposerActions } from "@/features/explorer/desktop/ExplorerAgentComposer";
import { agentPlaceholder } from "@/features/explorer/desktop/ExplorerAgentShared";
import { agentPanelStyles } from "@/features/explorer/desktop/ExplorerAgentStyles";
import { PersonalAgentsSidebar } from "./PersonalAgentsSidebar";
import type { AgentSidebarItem } from "./agentSidebarTypes";
import { AgentTypingIndicator } from "./AgentTypingIndicator";
import {
  initialAgentModelName,
  modelSupportsReasoning,
  selectedAgentModelName,
} from "@/features/agents/modelSelection";
import type { SpaceAgentMembership } from "@/models/interfaces/features/spaces/types";

const emptySpaceAgentMemberships: SpaceAgentMembership[] = [];
const builtInSpaceAgentId = "misty";

export default function DesktopAgentsPage() {
  return <AgentWorkspace />;
}

export interface AgentWorkspaceProps {
  embedded?: boolean;
  hideHeader?: boolean;
  spaceId?: string;
  contextLabel?: string;
  spaceSection?: string;
  taskId?: string;
  cwd?: string | null;
  selectedPaths?: string[];
  draftPrompt?: string;
  onDraftConsumed?: () => void;
}

export function AgentWorkspace({
  embedded = false,
  hideHeader = false,
  spaceId: requestedSpaceId,
  contextLabel,
  spaceSection,
  taskId,
  cwd = null,
  selectedPaths = [],
  draftPrompt = "",
  onDraftConsumed,
}: AgentWorkspaceProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const spaceId = requestedSpaceId ?? searchParams.get("spaceId") ?? "";
  const selectedAgentId = searchParams.get("agent") ?? "";
  const directModelId = searchParams.get("model") ?? "";
  const { spaceName, spaceAgentMemberships, spaceRosterLoaded, loadMembers } = useSpacesStore(
    useShallow((state) => ({
      spaceName: spaceId
        ? (state.spaces.find((space) => space.id === spaceId)?.name ?? spaceId)
        : null,
      spaceAgentMemberships: spaceId
        ? (state.agentMembershipsBySpace[spaceId] ?? emptySpaceAgentMemberships)
        : emptySpaceAgentMemberships,
      spaceRosterLoaded: spaceId
        ? Object.prototype.hasOwnProperty.call(state.agentMembershipsBySpace, spaceId)
        : true,
      loadMembers: state.loadMembers,
    })),
  );
  const personalAgents = usePersonalAgentsStore((state) => state.agents);
  const models = usePersonalAgentsStore((state) => state.models);
  const loadPersonalAgents = usePersonalAgentsStore((state) => state.load);
  const availableAgents = useMemo(
    () =>
      spaceId
        ? [
            {
              id: builtInSpaceAgentId,
              name: "Misty",
              model_id: undefined,
              reasoning_effort: undefined,
            },
            ...spaceAgentMemberships
              .filter((membership) => membership.enabled)
              .map((membership) => ({
                id: membership.agent_id,
                name: membership.name,
                model_id: membership.model_id,
                reasoning_effort: membership.reasoning_effort,
              })),
          ]
        : personalAgents,
    [personalAgents, spaceAgentMemberships, spaceId],
  );
  const selectedAgent = availableAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const sidebarAgents = useMemo<AgentSidebarItem[] | undefined>(
    () =>
      spaceId ? availableAgents.map((agent) => ({ id: agent.id, name: agent.name })) : undefined,
    [availableAgents, spaceId],
  );

  const {
    status,
    mode,
    messages,
    plans,
    actionPlans,
    toolApprovals,
    error,
    activeModelId,
    activeReasoningEffort,
    refreshStatus,
    hydrateConversations,
    setMode,
    setConversationModel,
    setConversationReasoning,
    sendPrompt,
    abortPrompt,
    approvePlan,
    approveActionPlan,
    reviseActionPlan,
    approveToolRequest,
    activateConversationScope,
    startNewConversation,
  } = useAgentSessionStore(
    useShallow((state) => ({
      status: state.status,
      mode: state.mode,
      messages: state.messages,
      plans: state.plans,
      actionPlans: state.actionPlans,
      toolApprovals: state.toolApprovals,
      error: state.error,
      activeModelId: state.activeModelId,
      activeReasoningEffort: state.activeReasoningEffort,
      refreshStatus: state.refreshStatus,
      hydrateConversations: state.hydrateConversations,
      setMode: state.setMode,
      setConversationModel: state.setConversationModel,
      setConversationReasoning: state.setConversationReasoning,
      sendPrompt: state.sendPrompt,
      abortPrompt: state.abortPrompt,
      approvePlan: state.approvePlan,
      approveActionPlan: state.approveActionPlan,
      reviseActionPlan: state.reviseActionPlan,
      approveToolRequest: state.approveToolRequest,
      activateConversationScope: state.activateConversationScope,
      startNewConversation: state.startNewConversation,
    })),
  );
  const [prompt, setPrompt] = useState("");
  const [pendingModelSwitch, setPendingModelSwitch] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const running = status?.running ?? false;
  const configured = status?.configured ?? false;
  const agentChatModelId = selectedAgent
    ? activeModelId || selectedAgent.model_id || ""
    : directModelId;
  const modelNameFor = useCallback(
    (modelId: string) =>
      models.find((model) => model.id === modelId)?.name ?? selectedAgentModelName(modelId),
    [models],
  );
  const agentChatModelName = selectedAgent
    ? modelNameFor(agentChatModelId)
    : (status?.modelName ?? initialAgentModelName);
  const agentChatSupportsReasoning = modelSupportsReasoning(
    models.find((model) => model.id === agentChatModelId)?.capabilities,
  );
  const agentChatReasoningEffort =
    activeReasoningEffort || selectedAgent?.reasoning_effort || "medium";
  useEffect(() => {
    if (!draftPrompt) return;
    setPrompt(draftPrompt);
    onDraftConsumed?.();
  }, [draftPrompt, onDraftConsumed]);
  const requestModelChange = useCallback(
    (modelId: string) => {
      if (!modelId || modelId === agentChatModelId) return;
      // An empty chat has nothing to resend, so switch straight away. Otherwise
      // let the person choose between keeping (and resending) or resetting history.
      if (messages.length === 0) {
        void setConversationModel(modelId, { resend: false });
        return;
      }
      setPendingModelSwitch(modelId);
    },
    [agentChatModelId, messages.length, setConversationModel],
  );
  const hostedAiUsage = useMemo(
    () => [...messages].reverse().find((message) => typeof message.hostedAiUsedRatio === "number"),
    [messages],
  );
  const hostedAiUsedPercent =
    typeof hostedAiUsage?.hostedAiUsedRatio === "number"
      ? Math.round(Math.min(1, Math.max(0, hostedAiUsage.hostedAiUsedRatio)) * 100)
      : null;
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    void hydrateConversations();
  }, [hydrateConversations]);
  useEffect(() => {
    if (!spaceId) void loadPersonalAgents();
  }, [loadPersonalAgents, spaceId]);
  useEffect(() => {
    if (spaceId) void loadMembers(spaceId).catch(() => undefined);
  }, [loadMembers, spaceId]);
  useEffect(() => {
    if (!user?.id || !selectedAgentId) return;
    const scopeKey =
      spaceId && selectedAgentId === builtInSpaceAgentId
        ? spaceAgentScopeKey(user.id, spaceId)
        : agentScopeKey(user.id, selectedAgentId, spaceId, "");
    void activateConversationScope(scopeKey);
  }, [activateConversationScope, selectedAgentId, spaceId, user?.id]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const submitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      // Custom Agents are grounded and equipped by the server. Sending the old
      // Files-assistant wrapper here made both global and Space Agents deny the
      // server-owned actions they can actually perform.
      prompt: trimmed,
      cwd,
      selectedPaths,
      spaceSection: spaceId ? spaceSection || "agents" : undefined,
      contextTaskId: spaceId ? taskId : undefined,
    });
  }, [cwd, prompt, running, selectedPaths, sendPrompt, spaceId, spaceSection, taskId]);

  const selectAgent = useCallback(
    (agentId: string) => {
      const next = new URLSearchParams(searchParams);
      if (agentId) next.set("agent", agentId);
      else next.delete("agent");
      next.delete("model");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if ((!spaceId && !embedded) || !spaceRosterLoaded) return;
    if (selectedAgentId && availableAgents.some((agent) => agent.id === selectedAgentId)) return;
    selectAgent(availableAgents[0]?.id ?? "");
  }, [availableAgents, embedded, selectAgent, selectedAgentId, spaceId, spaceRosterLoaded]);

  const startAgentChat = useCallback(
    async (agentId: string) => {
      selectAgent(agentId);
      if (!user?.id) return;
      // Ensure the agent's scope is live before creating the chat there. Both
      // calls are idempotent, so this is safe even when the agent is already open.
      const scopeKey =
        spaceId && agentId === builtInSpaceAgentId
          ? spaceAgentScopeKey(user.id, spaceId)
          : agentScopeKey(user.id, agentId, spaceId, "");
      await activateConversationScope(scopeKey);
      await startNewConversation();
    },
    [activateConversationScope, selectAgent, spaceId, startNewConversation, user?.id],
  );

  return (
    <div
      className={
        embedded
          ? "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden"
          : "grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)]"
      }
    >
      {!embedded ? (
        <aside className="flex h-full min-h-0 flex-col border-r border-border bg-[var(--misty-app-panel-bg,transparent)] p-4 max-[900px]:hidden">
          <div className="misty-transient-scrollbar flex min-h-0 flex-1 flex-col overflow-hidden [overscroll-behavior:contain]">
            <PersonalAgentsSidebar
              selectedAgentId={selectedAgentId}
              onSelect={selectAgent}
              onNewChat={(agentId) => void startAgentChat(agentId)}
              availableAgents={sidebarAgents}
              spaceName={spaceName}
            />
          </div>

          {hostedAiUsedPercent !== null ? (
            <section
              className="mt-4 shrink-0 rounded-md bg-sidebar-accent/35 p-3"
              aria-label="Hosted AI usage"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                  <Sparkles size={14} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-medium text-sidebar-accent-foreground">
                    Hosted AI
                  </strong>
                  <span className="block text-xs text-muted-foreground">
                    {Math.max(0, 100 - hostedAiUsedPercent)}% left this week
                  </span>
                </span>
              </div>
              <Progress className="mt-3 h-1.5" value={hostedAiUsedPercent} />
              <p className="mb-0 mt-2 text-[11px] text-muted-foreground">
                {hostedAiUsedPercent}% used
                {hostedAiUsage?.hostedAiResetAt
                  ? ` · resets ${new Date(hostedAiUsage.hostedAiResetAt).toLocaleDateString(
                      undefined,
                      {
                        weekday: "short",
                      },
                    )}`
                  : ""}
              </p>
            </section>
          ) : null}
        </aside>
      ) : null}
      {selectedAgent ? (
        <div
          className={
            embedded
              ? "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden p-3"
              : "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-6"
          }
        >
          {!hideHeader ? (
            <header className="flex min-w-0 items-center gap-2.5">
              <Bot className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h1 className="min-w-0 truncate text-lg font-semibold text-foreground">
                {selectedAgent.name}
              </h1>
            </header>
          ) : null}

          {error ? <p className={agentPanelStyles.errorText}>{error}</p> : null}

          <div ref={logRef} className={agentPanelStyles.log} aria-live="polite">
            {messages.length === 0
              ? null
              : messages.map((message) => (
                  <AgentMessage
                    key={message.id}
                    message={message}
                    running={running}
                    plans={plans}
                    actionPlans={actionPlans}
                    toolApprovals={toolApprovals}
                    onApplyPlan={approvePlan}
                    onApproveTool={approveToolRequest}
                    onApproveAction={approveActionPlan}
                    onReviseAction={(planId) => {
                      const request = reviseActionPlan(planId);
                      if (request) setPrompt(request.displayPrompt);
                    }}
                    spacious={!embedded}
                  />
                ))}
            {running ? <AgentTypingIndicator /> : null}
          </div>

          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt();
            }}
          >
            <div className="relative z-10 min-w-0 rounded-xl bg-muted/60">
              <Textarea
                className={[
                  "max-h-[260px] min-h-[72px] w-full resize-none rounded-none border-0",
                  "bg-transparent px-4 pb-2 pt-3.5 text-sm shadow-none focus-visible:ring-0",
                ].join(" ")}
                value={prompt}
                rows={3}
                placeholder={agentPlaceholder(configured, "Ask an agent anything...")}
                disabled={!configured || running}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitPrompt();
                  }
                }}
              />
              <AgentComposerActions
                mode={mode}
                modelName={agentChatModelName}
                configured={configured}
                running={running}
                prompt={prompt}
                setMode={setMode}
                abortPrompt={abortPrompt}
                showAccessControls={false}
                contextLabel={
                  contextLabel ||
                  (spaceName
                    ? `Tools scoped to ${spaceName}`
                    : selectedPaths.length
                      ? `${selectedPaths.length} selected`
                      : "Server-managed tools")
                }
                modelOptions={spaceId ? undefined : models}
                selectedModelId={agentChatModelId}
                reasoningEffort={agentChatReasoningEffort}
                reasoningSupported={agentChatSupportsReasoning}
                onSelectReasoning={
                  spaceId ? undefined : (effort) => void setConversationReasoning(effort)
                }
                onSelectModel={
                  spaceId
                    ? undefined
                    : selectedAgent
                      ? requestModelChange
                      : (modelId) => {
                          const next = new URLSearchParams(searchParams);
                          if (modelId) next.set("model", modelId);
                          else next.delete("model");
                          setSearchParams(next);
                        }
                }
              />
            </div>
          </form>

          <AlertDialog
            open={pendingModelSwitch !== null}
            onOpenChange={(open) => {
              if (!open) setPendingModelSwitch(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Switch this chat to {pendingModelSwitch ? modelNameFor(pendingModelSwitch) : ""}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This changes the model for this chat only — {selectedAgent?.name}&rsquo;s
                  configured model stays the same. To keep the conversation going, the entire chat
                  is resent to the new model on your next message, which costs extra tokens. Or
                  reset to start this chat fresh on the new model.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => {
                    if (pendingModelSwitch)
                      void setConversationModel(pendingModelSwitch, { resend: false });
                    setPendingModelSwitch(null);
                  }}
                >
                  Reset chat
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingModelSwitch)
                      void setConversationModel(pendingModelSwitch, { resend: true });
                    setPendingModelSwitch(null);
                  }}
                >
                  Keep &amp; resend
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="grid h-full min-h-0 place-items-center p-6">
          <div className="max-w-xs text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-muted/60 text-muted-foreground">
              <Bot size={26} aria-hidden="true" />
            </div>
            <h2 className="m-0 text-lg font-semibold text-foreground">Select an Agent</h2>
            <p className="mb-0 mt-1.5 text-sm text-muted-foreground">
              Choose an agent from the list, or create one to get started.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
