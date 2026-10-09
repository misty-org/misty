import {
  AgentQuestionCard,
  pendingQuestionSet,
  useConversationCollaboration,
} from "@/features/agents/agentCollaboration";
import { MistyOverlayControls } from "./MistyOverlayControls";
import { readOptionalSurfaceContext } from "./optionalSurfaceContext";
import { thinkingEffort } from "@/features/agents/thinkingMode";
import { requestEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { invokeShortcutCommand } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace/core";
import { cn, ScrollArea, ViewportLayer } from "@/shared/ui";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { GlobalMistyComposerBar } from "./GlobalMistyChrome";
import { WaitingForYouCard } from "@/features/agent-interventions/WaitingForYouCard";
import { ConversationView } from "./GlobalMistyPanelContent";
import { captureToFile } from "./mistyImageAttachments";
import {
  CandidateList,
  ContextReceipt,
  FilterBar,
  contextForCurrentView,
  removeLastFilter,
} from "./GlobalMistySupport";
import { mergeGlobalMistyContext } from "./globalMistyContext";
import type { UnifiedMistyCandidate } from "./types";
import { buildUnifiedMistyCandidates } from "./unifiedMistyCandidates";
import { useGlobalMistyAttachments } from "./useGlobalMistyAttachments";
import { useGlobalMistyResults } from "./useGlobalMistyResults";
import { useGlobalMistyHost } from "./useGlobalMistyHost";
import { useGlobalSearchStore } from "./useGlobalSearchStore";

const MistyRegionCapture = lazy(() =>
  import("@/features/ai-surface/MistyRegionCapture").then((module) => ({
    default: module.MistyRegionCapture,
  })),
);

const panelClass = [
  "pointer-events-auto flex max-h-[min(680px,calc(100dvh-120px))]",
  "w-[min(820px,calc(100dvw-48px))] flex-col overflow-hidden rounded-2xl will-change-transform",
  "border border-white/10 bg-charcoal-card/95 text-cream backdrop-blur-2xl",
].join(" ");
const panelShadowClass = "shadow-[0_28px_90px_rgba(0,0,0,0.62)]";
/** The search launcher; conversations live on the Agents page. */
export function GlobalMistySurface(props: {
  accountId: string;
  currentPath: string;
  activePaneId: string;
  activeWorkspacePaneId?: string;
  includeCurrentContext?: boolean;
  allowCapture?: boolean;
  suspendBrowserWebviews?: boolean;
  onNavigate?: (href: string) => void;
  onCommand?: (commandId?: string, tabId?: string) => void;
  onClosed?: () => void;
  showShadow?: boolean;
  onContentVisibilityChange?: (visible: boolean) => void;
  onVoiceActivityChange?: (active: boolean) => void;
}) {
  const {
    includeCurrentContext = true,
    allowCapture = true,
    suspendBrowserWebviews = true,
    onNavigate,
    onCommand,
    onClosed,
    showShadow = true,
    onContentVisibilityChange,
    onVoiceActivityChange,
  } = props;
  const useController = useGlobalSearchStore;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [capturingRegion, setCapturingRegion] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const {
    panel,
    mode,
    query,
    results,
    searching,
    working,
    error,
    browserNotice,
    context,
    conversations,
    activeConversationId,
    thinkingMode,
    filters,
    selectedCandidateId,
    setAccount,
    closePanel,
    setMode,
    setQuery,
    setFilters,
    setSelectedCandidateId,
    setContext,
    removeContext,
    loadConversations,
    newConversation,
    search,
    visualSearch,
    submitAnswer,
    submitAgentTask,
  } = useController(
    useShallow((state) => ({
      panel: state.panel,
      mode: state.mode,
      query: state.query,
      results: state.results,
      searching: state.searching,
      working: state.working,
      error: state.error,
      browserNotice: state.browserRequest?.notice,
      context: state.context,
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      thinkingMode: state.thinkingMode,
      filters: state.filters,
      selectedCandidateId: state.selectedCandidateId,
      setAccount: state.setAccount,
      closePanel: state.closePanel,
      setMode: state.setMode,
      setQuery: state.setQuery,
      setFilters: state.setFilters,
      setSelectedCandidateId: state.setSelectedCandidateId,
      setContext: state.setContext,
      removeContext: state.removeContext,
      loadConversations: state.loadConversations,
      newConversation: state.newConversation,
      search: state.search,
      visualSearch: state.visualSearch,
      submitAnswer: state.submitAnswer,
      submitAgentTask: state.submitAgentTask,
    })),
  );
  const aiPaneId = props.activeWorkspacePaneId ?? props.activePaneId;
  const aiRegistration = useAiSurfaceStore((state) =>
    Object.values(state.registrations).find(
      (registration) =>
        registration.accountId === props.accountId && registration.paneId === aiPaneId,
    ),
  );
  // A surface adapter may be denied, revoked or closed while its pane is mounted.
  // Optional context must never throw through the workspace render boundary.
  const surfaceSnapshot = useMemo(
    () => readOptionalSurfaceContext(includeCurrentContext ? aiRegistration?.adapter : undefined),
    // Re-read mutable adapter context when the panel or draft changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiRegistration, includeCurrentContext, panel, query],
  );
  const registeredAiContext = surfaceSnapshot.context;
  const browserRequest = useController((state) => state.browserRequest);
  const registeredAiSelection = browserRequest?.selection ?? surfaceSnapshot.selection;
  const currentContext = useMemo(
    () =>
      !includeCurrentContext ? [] : contextForCurrentView(props.currentPath, registeredAiContext),
    [includeCurrentContext, props.currentPath, registeredAiContext],
  );
  const activeMode = mode === "search" ? "search" : "ask";
  const attachmentState = useGlobalMistyAttachments({
    sharedAccountId: undefined,
    mode,
    activeConversationId,
    newConversation,
    setMode,
    onError: setVoiceError,
  });
  const { attachments } = attachmentState;
  const hasQuery = Boolean(query.trim() || attachments.length);
  const candidates = useMemo(() => {
    if (!query.trim() && !attachments.length) return [];
    return buildUnifiedMistyCandidates(query.trim() || "Visual search", results, filters).filter(
      (candidate) =>
        activeMode === "search"
          ? candidate.type !== "agent_task"
          : candidate.type === "answer" || candidate.type === "agent_task",
    );
  }, [activeMode, attachments.length, filters, query, results]);
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((candidate) => candidate.id === selectedCandidateId),
  );
  const conversation = conversations.find((item) => item.id === activeConversationId);
  // Questions an agent asked in this conversation wait above the composer here too.
  const collaboration = useConversationCollaboration(
    props.accountId,
    activeConversationId || undefined,
  );
  const pendingQuestions = pendingQuestionSet(collaboration.state);
  const open = panel !== "closed";
  const conversationActive = panel === "answer" || panel === "agent";
  const contentVisible = hasQuery || conversationActive;
  const wasOpenRef = useRef(false);
  const voice = useAiVoiceRecorder({
    contextKey: `${props.accountId}:${activeConversationId}`,
    onTranscript: (transcript) => {
      const current = useController.getState().query.trim();
      useController.getState().setQuery(`${current}${current ? " " : ""}${transcript}`);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    onError: setVoiceError,
    onActivityChange: onVoiceActivityChange,
  });
  const resultActions = useGlobalMistyResults({
    activePaneId: props.activePaneId,
    context,
    setContext,
    closePanel,
    onNavigate,
  });

  useEffect(() => setAccount(props.accountId), [props.accountId, setAccount]);
  useEffect(() => {
    if (!open) return;
    if (!useController.getState().browserRequest && !useController.getState().handoff) {
      setContext(mergeGlobalMistyContext(useController.getState().context, currentContext));
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [currentContext, open, setContext, useController]);
  useEffect(() => {
    if (!open || activeMode !== "ask") return;
    const state = useController.getState();
    if (!state.conversations.length && !state.conversationsLoading) void loadConversations();
  }, [activeMode, loadConversations, open, useController]);
  useEffect(() => {
    if (panel !== "results") return;
    const visual =
      activeMode === "search" ? attachments.find((item) => item.state === "ready") : undefined;
    const timer = window.setTimeout(() => {
      if (visual) void visualSearch(visual.id, query);
      else void search(query);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [activeMode, attachments, filters, panel, query, search, visualSearch]);
  useEffect(() => {
    const preferred = candidates.some((candidate) => candidate.id === selectedCandidateId)
      ? selectedCandidateId
      : (candidates[0]?.id ?? "");
    if (preferred !== selectedCandidateId) setSelectedCandidateId(preferred);
  }, [candidates, selectedCandidateId, setSelectedCandidateId]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel, open]);
  useEffect(() => {
    if (!suspendBrowserWebviews) return;
    requestEmbeddedBrowserSuspension(open, "global-search");
    return () => requestEmbeddedBrowserSuspension(false, "global-search");
  }, [open, suspendBrowserWebviews]);
  useEffect(() => {
    if (wasOpenRef.current && !open) onClosed?.();
    wasOpenRef.current = open;
  }, [onClosed, open]);
  useEffect(() => {
    if (open) onContentVisibilityChange?.(contentVisible);
  }, [contentVisible, onContentVisibilityChange, open]);
  const sendAnswer = async (prompt: string) => {
    // The task looks at the screen itself (screen_look) when the request needs it.
    await submitAnswer(prompt, attachmentState.attachments, registeredAiSelection ?? undefined);
    if (!useController.getState().query) attachmentState.consume();
  };
  const activateCandidate = (candidate?: UnifiedMistyCandidate) => {
    if (!candidate || working) return;
    if (candidate.type === "object" || candidate.type === "navigation") {
      void resultActions.openResult(candidate.result);
      return;
    }
    if (candidate.type === "answer") {
      void sendAnswer(candidate.prompt);
      return;
    }
    if (candidate.type === "agent_task") {
      void submitAgentTask(candidate.prompt, aiPaneId);
      return;
    }
    if (candidate.type === "command") {
      closePanel();
      if (onCommand) onCommand(candidate.commandId, candidate.tabId);
      else if (candidate.tabId) useWorkspaceStore.getState().focusView(candidate.tabId);
      else if (candidate.commandId) invokeShortcutCommand(candidate.commandId);
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!conversationActive && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const index = candidates.length
        ? (selectedIndex + direction + candidates.length) % candidates.length
        : 0;
      setSelectedCandidateId(candidates[index]?.id ?? "");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (activeMode === "ask") {
        void sendAnswer(query);
      } else activateCandidate(candidates[selectedIndex] ?? candidates[0]);
      return;
    }
    if (
      !conversationActive &&
      event.key === "Backspace" &&
      !query &&
      removeLastFilter(filters, setFilters)
    ) {
      event.preventDefault();
    }
  };

  const composer = (
    <>
      {mode !== "search" && conversation ? (
        <div className="px-3 pt-2 empty:hidden">
          <WaitingForYouCard
            accountId={props.accountId}
            agentName="Misty"
            invocationIds={conversation.messages.flatMap((message) =>
              message.invocationId ? [message.invocationId] : [],
            )}
            revision={working}
          />
        </div>
      ) : null}
      {pendingQuestions && mode !== "search" && (
        <div className="px-3 pt-2">
          <AgentQuestionCard
            questionSet={pendingQuestions}
            agentName="Misty"
            onContinue={(prompt) => void submitAnswer(prompt, [], undefined)}
          />
        </div>
      )}
      <GlobalMistyComposerBar
        accountId={props.accountId}
        reasoningEffort={conversation?.reasoningEffort || thinkingEffort(thinkingMode ?? "normal")}
        query={query}
        onQuery={setQuery}
        mode={activeMode}
        conversationActive={conversationActive && !!conversation?.messages.length}
        textareaRef={inputRef}
        attachments={attachments}
        onModeChange={attachmentState.changeMode}
        onAddFiles={attachmentState.addFiles}
        onRemoveAttachment={attachmentState.remove}
        onSubmit={() => {
          if (activeMode === "ask") {
            void sendAnswer(query);
          } else activateCandidate(candidates[selectedIndex] ?? candidates[0]);
        }}
        onKeyDown={onInputKeyDown}
        onCapture={allowCapture ? () => setCapturingRegion(true) : undefined}
        busy={searching || (working && !query.trim())}
        working={working}
        conversation={conversation}
        activeConversationId={activeConversationId}
        voice={voice}
        onError={setVoiceError}
        onClose={closePanel}
        onModelChange={(settings) =>
          useController.setState((state) =>
            state.accountId !== props.accountId
              ? state
              : {
                  thinkingModeExplicit: true,
                  thinkingMode:
                    state.activeConversationId === activeConversationId
                      ? settings.reasoningEffort === "xhigh"
                        ? "deep"
                        : "normal"
                      : state.thinkingMode,
                  conversations: state.conversations.map((item) =>
                    item.id === activeConversationId ? { ...item, ...settings } : item,
                  ),
                },
          )
        }
      />
    </>
  );

  return (
    <ViewportLayer
      layer="chrome"
      passthrough
      className="flex flex-col items-center pt-[9vh]"
      data-global-misty-root
    >
      {error || voiceError ? (
        <SystemErrorNotice
          error={error || voiceError}
          scope={`misty:${mode}`}
          title="Misty request could not be completed"
        />
      ) : null}
      <MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="unified-misty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none flex flex-col items-center gap-2"
              data-html2canvas-ignore="true"
            >
              <section
                className={cn(
                  panelClass,
                  conversationActive && "h-[min(640px,calc(100dvh-120px))]",
                  showShadow && panelShadowClass,
                )}
                aria-label="Misty Search"
                data-misty-conversation={conversationActive ? "true" : undefined}
                data-misty-content={contentVisible ? "true" : "false"}
              >
                {browserNotice ? (
                  <p
                    role="status"
                    className="border-b border-white/10 px-4 py-3 text-sm text-cream/70"
                  >
                    {browserNotice} You can still ask about the attached content.
                  </p>
                ) : null}
                {conversationActive ? (
                  <>
                    <ContextReceipt
                      context={context.filter((item) => item.attached)}
                      selection={registeredAiSelection ?? undefined}
                      onRemove={removeContext}
                    />
                    <div className="min-h-0 flex-1">
                      <ScrollArea className="h-full" data-misty-conversation-scroll>
                        <ConversationView conversation={conversation} working={working} />
                      </ScrollArea>
                    </div>
                    {composer}
                  </>
                ) : (
                  <>
                    {composer}
                    <ContextReceipt
                      context={context}
                      selection={registeredAiSelection ?? undefined}
                      onRemove={removeContext}
                    />
                    {hasQuery ? (
                      <FilterBar
                        mode={mode}
                        filters={filters}
                        currentContext={currentContext}
                        onChange={setFilters}
                      />
                    ) : null}
                    {contentVisible ? (
                      <div className="min-h-0 flex-1 border-t border-charcoal-border/70">
                        <ScrollArea
                          className="h-[min(500px,calc(100dvh-270px))]"
                          data-misty-results-scroll
                        >
                          <CandidateList
                            candidates={candidates}
                            selectedId={selectedCandidateId}
                            searching={searching}
                            onSelect={setSelectedCandidateId}
                            onActivate={activateCandidate}
                            onAddContext={resultActions.addResultContext}
                          />
                        </ScrollArea>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </MotionConfig>
      {capturingRegion && allowCapture ? (
        <Suspense fallback={null}>
          <MistyRegionCapture
            onCancel={() => setCapturingRegion(false)}
            onCapture={(nextCapture) => {
              setCapturingRegion(false);
              void attachmentState.addFiles([captureToFile(nextCapture)]);
            }}
          />
        </Suspense>
      ) : null}
    </ViewportLayer>
  );
}

export function GlobalMisty(props: Parameters<typeof GlobalMistySurface>[0]) {
  const bridgeError = useGlobalMistyHost();
  return (
    <>
      {bridgeError && (
        <SystemErrorNotice
          error={bridgeError}
          scope="misty:context-bridge"
          title="Misty context could not start"
        />
      )}
      <MistyOverlayControls />
      <GlobalMistySurface {...props} />
    </>
  );
}
