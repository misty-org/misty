import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Bot, Sparkles } from "lucide-react";
import { Badge } from "@/ui";
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
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { useMultiPanelStore } from "@/features/workspace";
import { useAppStore } from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import { MistyPicker } from "@/features/picker/MistyPicker";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { agentMikaScopeKey, useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";
import { usePersonalAgentsStore } from "@/stores/agents/usePersonalAgentsStore";
import { useAuth } from "@/features/auth/AuthContext";
import { AssistantMessage } from "@/features/explorer/desktop/ExplorerAssistantMessage";
import { AssistantComposerActions } from "@/features/explorer/desktop/ExplorerAssistantComposer";
import {
  assistantPlaceholder,
  useMikaPeekAnimation,
} from "@/features/explorer/desktop/ExplorerAssistantShared";
import { assistantPanelStyles } from "@/features/explorer/desktop/ExplorerAssistantStyles";
import { PersonalAgentsSidebar } from "./PersonalAgentsSidebar";
import { initialAgentModelName, selectedAgentModelName } from "@/features/agents/modelSelection";

function defaultWorkingDirectory(pathParam: string | null): string {
  if (pathParam) return pathParam;
  const activePaneId = useMultiPanelStore.getState().activePaneId;
  return useExplorerStore.getState().panes[activePaneId]?.listing?.path ?? "";
}

export default function DesktopAgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [workingDirectory] = useState(() => defaultWorkingDirectory(searchParams.get("path")));
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [manualContextPaths, setManualContextPaths] = useState<string[]>([]);
  const paramPaths = useMemo(() => {
    const raw = searchParams.get("paths");
    return raw
      ? raw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  }, [searchParams]);
  const selectedPaths = useMemo(
    () => [...new Set([...paramPaths, ...manualContextPaths])],
    [paramPaths, manualContextPaths],
  );
  const spaceId = searchParams.get("spaceId") ?? "";
  const selectedAgentId = searchParams.get("agent") ?? "";
  const directModelId = searchParams.get("model") ?? "";
  const spaceName = useSpacesStore((state) =>
    spaceId ? (state.spaces.find((space) => space.id === spaceId)?.name ?? spaceId) : null,
  );
  const agents = usePersonalAgentsStore((state) => state.agents);
  const models = usePersonalAgentsStore((state) => state.models);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const {
    status,
    mode,
    messages,
    plans,
    toolApprovals,
    error,
    activeModelId,
    refreshStatus,
    hydrateConversations,
    setMode,
    setConversationModel,
    sendPrompt,
    abortPrompt,
    approvePlan,
    approveToolRequest,
    activateConversationScope,
    startNewConversation,
  } = useMikaSessionStore(
    useShallow((state) => ({
      status: state.status,
      mode: state.mode,
      messages: state.messages,
      plans: state.plans,
      toolApprovals: state.toolApprovals,
      error: state.error,
      activeModelId: state.activeModelId,
      refreshStatus: state.refreshStatus,
      hydrateConversations: state.hydrateConversations,
      setMode: state.setMode,
      setConversationModel: state.setConversationModel,
      sendPrompt: state.sendPrompt,
      abortPrompt: state.abortPrompt,
      approvePlan: state.approvePlan,
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
  // The model this chat is actually using: its per-chat override if set, else the
  // agent's configured model. The agent's own model is never changed from here.
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
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const mikaAnimationSource = runtimeAssetSource(assetsDir, "animations/mika.webp");
  const mikaPeek = useMikaPeekAnimation(true);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  // Sessions live on the account, so a device that has never seen them still lists them.
  useEffect(() => {
    void hydrateConversations();
  }, [hydrateConversations]);
  useEffect(() => {
    if (!user?.id || !selectedAgentId) return;
    void activateConversationScope(agentMikaScopeKey(user.id, selectedAgentId, spaceId, ""));
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
      prompt: buildAssistantPrompt(trimmed, workingDirectory, selectedPaths, spaceName),
      cwd: workingDirectory || null,
      selectedPaths,
    });
  }, [prompt, running, selectedPaths, sendPrompt, spaceName, workingDirectory]);

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

  const startAgentChat = useCallback(
    async (agentId: string) => {
      selectAgent(agentId);
      if (!user?.id) return;
      // Ensure the agent's scope is live before creating the chat there. Both
      // calls are idempotent, so this is safe even when the agent is already open.
      await activateConversationScope(agentMikaScopeKey(user.id, agentId, spaceId, ""));
      await startNewConversation();
    },
    [activateConversationScope, selectAgent, spaceId, startNewConversation, user?.id],
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)]">
      <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar/40 p-4 max-[900px]:hidden">
        <div className="misty-transient-scrollbar flex min-h-0 flex-1 flex-col overflow-hidden [overscroll-behavior:contain]">
          <PersonalAgentsSidebar
            selectedAgentId={selectedAgentId}
            onSelect={selectAgent}
            onNewChat={(agentId) => void startAgentChat(agentId)}
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
      {selectedAgent ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-6">
          <header className="flex min-w-0 items-center gap-2.5">
            <Bot className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h1 className="min-w-0 truncate text-lg font-semibold text-foreground">
              {selectedAgent.name}
            </h1>
            {running ? (
              <Badge variant="secondary" className="shrink-0">
                Running
              </Badge>
            ) : null}
          </header>

          {error ? <p className={assistantPanelStyles.errorText}>{error}</p> : null}

          <div ref={logRef} className={`${assistantPanelStyles.log} gap-2.5`} aria-live="polite">
            {messages.length === 0
              ? null
              : messages.map((message) => (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    running={running}
                    plans={plans}
                    toolApprovals={toolApprovals}
                    onApplyPlan={approvePlan}
                    onApproveTool={approveToolRequest}
                  />
                ))}
          </div>

          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt();
            }}
          >
            {mikaAnimationSource ? (
              <img
                alt=""
                aria-hidden="true"
                className={[
                  "pointer-events-none absolute -top-14 z-0 h-20 w-24 select-none object-contain",
                  "drop-shadow-md transition-[opacity,transform] duration-500 ease-out",
                  "motion-reduce:transition-none",
                  mikaPeek.popped ? "opacity-100" : "opacity-0",
                ].join(" ")}
                draggable={false}
                src={mikaAnimationSource}
                onError={hideRuntimeAssetOnError}
                onLoad={revealRuntimeAssetOnLoad}
                style={{
                  left: `${mikaPeek.leftPercent}%`,
                  transform: mikaPeek.popped
                    ? `translateX(-50%) translateY(0) scale(1) rotate(${mikaPeek.tiltDegrees}deg)`
                    : `translateX(-50%) translateY(48px) scale(0.82) rotate(${mikaPeek.tiltDegrees}deg)`,
                }}
              />
            ) : null}
            <div className="relative z-10 min-w-0 rounded-xl bg-muted/60">
              <Textarea
                className={[
                  "max-h-[260px] min-h-[72px] w-full resize-none rounded-none border-0",
                  "bg-transparent px-4 pb-2 pt-3.5 text-sm shadow-none focus-visible:ring-0",
                ].join(" ")}
                value={prompt}
                rows={3}
                placeholder={assistantPlaceholder(configured, "Ask an agent anything...")}
                disabled={!configured || running}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitPrompt();
                  }
                }}
              />
              <AssistantComposerActions
                mode={mode}
                modelName={agentChatModelName}
                configured={configured}
                running={running}
                prompt={prompt}
                setMode={setMode}
                abortPrompt={abortPrompt}
                onAddContext={() => setContextPickerOpen(true)}
                modelOptions={models}
                selectedModelId={agentChatModelId}
                onSelectModel={
                  selectedAgent
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

          {contextPickerOpen ? (
            <MistyPicker
              multiple
              title="Add files as agent context"
              onCancel={() => setContextPickerOpen(false)}
              onChooseFiles={(paths) => {
                setManualContextPaths((current) => [...new Set([...current, ...paths])]);
                setContextPickerOpen(false);
              }}
            />
          ) : null}

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
                  This changes the model for this chat only — {selectedAgent?.name}&rsquo;s configured
                  model stays the same. To keep the conversation going, the entire chat is resent to
                  the new model on your next message, which costs extra tokens. Or reset to start this
                  chat fresh on the new model.
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

function buildAssistantPrompt(
  userPrompt: string,
  workingDirectory: string,
  selectedPaths: string[],
  spaceName: string | null,
): string {
  const selectedContext =
    selectedPaths.length > 0
      ? [`Selected items (${selectedPaths.length}):`, ...selectedPaths.map((path) => `- ${path}`)]
      : ["Selected items: none"];
  const context = [
    "You are helping inside Misty from the global Agents surface.",
    "Agents are beta and experimental.",
    [
      "Your main goal is to help reorganize files. You may chat freely, but tool-assisted work",
      "should stay focused on listing, searching, validating, and proposing safe file organization plans.",
    ].join(" "),
    "Do not inspect file contents or ask for preview tools. For changes, propose a file plan with folders, moves, and renames for the user to review.",
    spaceName ? `Current Space: ${spaceName}` : null,
    workingDirectory ? `Current folder: ${workingDirectory}` : "Current folder: none",
    ...selectedContext,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return `${context}\n\nUser request:\n${userPrompt}`;
}
