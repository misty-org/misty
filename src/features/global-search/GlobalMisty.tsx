import { isAgentModeActive } from "./searchAvailability";
import {
  MistyApprovalReview,
  MistyOverlayControls,
  usePendingMistyApproval,
} from "./MistyOverlayControls";
import { routeLocalFollowup, useLocalExecution } from "@/features/agents/localExecution";
import { readOptionalSurfaceContext } from "./optionalSurfaceContext";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { installMistyContextBridge } from "@/features/misty/contextBridge";
import { MistyContextBar } from "@/features/misty/MistyContextBar";
import { thinkingEffort } from "@/features/agents/thinkingMode";
import { requestEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { SystemErrorActivity } from "@/features/activity";
import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { invokeShortcutCommand } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace/core";
import { ScrollArea, cn } from "@/shared/ui";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { GlobalMistyComposerBar, GlobalMistyConversationControls } from "./GlobalMistyChrome";
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
export function GlobalMistySurface(props: {
  controller?: "search" | "misty";
  accountId: string;
  currentPath: string;
  activePaneId: string;
  activeWorkspacePaneId?: string;
  activePanePath: string;
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
  const execution = useLocalExecution((s) => s.execution);
  const pendingApproval = usePendingMistyApproval();
  const docked = props.controller === "misty";
  const taskSurface = docked && !!execution;
  const useController = props.controller === "misty" ? useMistyStore : useGlobalSearchStore;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [capturingRegion, setCapturingRegion] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [routingFollowup, setRoutingFollowup] = useState(false);
  const routingFollowupRef = useRef(false);
  const [followupNotice, setFollowupNotice] = useState("");
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
    conversationsLoading,
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
    selectConversation,
    deleteConversation,
    renameConversation,
    search,
    visualSearch,
    submitAnswer,
    submitAgentTask,
    rejectAction,
    cancelAgentTask,
    approveAgentTask,
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
      conversationsLoading: state.conversationsLoading,
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
      selectConversation: state.selectConversation,
      deleteConversation: state.deleteConversation,
      renameConversation: state.renameConversation,
      search: state.search,
      visualSearch: state.visualSearch,
      submitAnswer: state.submitAnswer,
      submitAgentTask: state.submitAgentTask,
      rejectAction: state.rejectAction,
      cancelAgentTask: state.cancelAgentTask,
      approveAgentTask: state.approveAgentTask,
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
      !includeCurrentContext
        ? []
        : contextForCurrentView(
            props.currentPath,
            props.activePanePath,
            undefined,
            registeredAiContext,
          ),
    [includeCurrentContext, props.activePanePath, props.currentPath, registeredAiContext],
  );
  const activeMode = mode === "search" ? "search" : "ask";
  const attachmentState = useGlobalMistyAttachments({
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
  const open = panel !== "closed" || taskSurface || (docked && !!pendingApproval);
  const conversationActive = panel === "answer" || panel === "agent";
  const contentVisible = hasQuery || conversationActive;
  const wasOpenRef = useRef(false);
  const voice = useAiVoiceRecorder({
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
    if (
      props.controller !== "misty" &&
      !useController.getState().browserRequest &&
      !useController.getState().handoff
    ) {
      setContext(mergeGlobalMistyContext(useController.getState().context, currentContext));
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [currentContext, open, setContext, useController, props.controller]);
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
      if (showSetup) setShowSetup(false);
      else closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel, open, showSetup]);
  useEffect(() => {
    if (!suspendBrowserWebviews || taskSurface) return;
    requestEmbeddedBrowserSuspension(open, "global-misty");
    return () => requestEmbeddedBrowserSuspension(false, "global-misty");
  }, [open, suspendBrowserWebviews, taskSurface]);
  useEffect(() => {
    if (wasOpenRef.current && !open) onClosed?.();
    wasOpenRef.current = open;
  }, [onClosed, open]);
  useEffect(() => {
    if (open) onContentVisibilityChange?.(contentVisible);
  }, [contentVisible, onContentVisibilityChange, open]);
  const sendAnswer = async (prompt: string) => {
    if (taskSurface) {
      if (!prompt.trim() || routingFollowupRef.current) return;
      if (attachments.length) {
        setVoiceError("Remove attachments to send a message to the active task.");
        return;
      }
      routingFollowupRef.current = true;
      setRoutingFollowup(true);
      setVoiceError("");
      setFollowupNotice("");
      try {
        const notice = await routeLocalFollowup(prompt);
        setFollowupNotice(notice);
        if (useController.getState().query === prompt) setQuery("");
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error));
      } finally {
        routingFollowupRef.current = false;
        setRoutingFollowup(false);
      }
      return;
    }
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
      else if (candidate.tabId) useWorkspaceStore.getState().focusTab(candidate.tabId);
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
      <GlobalMistyComposerBar
        headerControls={
          docked ? (
            <>
              <GlobalMistyConversationControls
                conversations={conversations}
                activeConversationId={activeConversationId}
                loading={conversationsLoading}
                onSelect={selectConversation}
                onNew={() => void newConversation()}
                onDelete={(id) => void deleteConversation(id)}
                onRename={(id, title) => void renameConversation(id, title)}
              />
            </>
          ) : undefined
        }
        accountId={props.accountId}
        reasoningEffort={conversation?.reasoningEffort || thinkingEffort(thinkingMode ?? "normal")}
        showSettings={showSetup}
        onToggleSettings={() => setShowSetup((visible) => !visible)}
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
        busy={taskSurface ? routingFollowup : searching || working}
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
    <div
      className={
        docked
          ? "pointer-events-none fixed inset-0 z-[2147482500] flex flex-col items-center px-4 pt-10"
          : "pointer-events-none fixed inset-0 z-[2147482500] flex flex-col items-center pt-[9vh]"
      }
      data-global-misty-root
    >
      {docked && open && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-2xl border border-white/20 bg-black/10"
          data-misty-capture-frame
        />
      )}
      {error || voiceError ? (
        <SystemErrorActivity
          accountId={props.accountId}
          error={error || voiceError}
          scope={`misty:${mode}`}
          title="Misty request could not be completed"
          target={{ kind: "route", href: props.currentPath }}
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
              className={cn(
                "pointer-events-none flex flex-col items-center",
                docked
                  ? "relative w-[min(600px,100%)] max-h-[calc(100dvh-140px)] overflow-hidden rounded-xl bg-charcoal-card text-cream shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
                  : "gap-2",
              )}
              data-html2canvas-ignore="true"
            >
              {docked ? (
                <div
                  className="pointer-events-auto w-full shrink-0 text-cream"
                  data-misty-top-controls
                >
                  {composer}
                  <MistyApprovalReview />
                  <MistyContextBar />
                  {followupNotice && (
                    <p role="status" className="px-4 pb-2 text-sm text-cream-muted">
                      {followupNotice}
                    </p>
                  )}
                </div>
              ) : null}
              <section
                className={cn(
                  docked
                    ? "pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden border-t border-white/10 text-cream"
                    : panelClass,
                  docked && (panel === "closed" || !conversation?.messages.length) && "hidden",
                  conversationActive && !docked && "h-[min(640px,calc(100dvh-120px))]",
                  showShadow && !docked && panelShadowClass,
                )}
                aria-label={docked ? "Misty conversation" : "Misty Search"}
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
                    {!docked && (
                      <ContextReceipt
                        context={context.filter((item) => item.attached)}
                        selection={registeredAiSelection ?? undefined}
                        onRemove={removeContext}
                      />
                    )}
                    <div className="min-h-0 flex-1">
                      <ScrollArea
                        className={docked ? "h-[min(320px,calc(100dvh-340px))]" : "h-full"}
                        data-misty-conversation-scroll
                      >
                        <ConversationView
                          conversation={conversation}
                          approvalControlsInFooter={docked}
                          working={working}
                          onConfirm={(id) => void approveAgentTask(id)}
                          onReject={rejectAction}
                          onCancel={(id) => void cancelAgentTask(id)}
                        />
                      </ScrollArea>
                    </div>
                    {!docked && composer}
                  </>
                ) : (
                  <>
                    {!docked && composer}
                    {!docked && (
                      <ContextReceipt
                        context={context}
                        selection={registeredAiSelection ?? undefined}
                        onRemove={removeContext}
                      />
                    )}
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
    </div>
  );
}

export function GlobalMisty(props: Parameters<typeof GlobalMistySurface>[0]) {
  useEffect(() => {
    const enforceAgentMode = () => {
      if (isAgentModeActive() && useGlobalSearchStore.getState().panel !== "closed")
        useGlobalSearchStore.getState().closePanel();
    };
    enforceAgentMode();
    const removeMisty = useMistyStore.subscribe(enforceAgentMode);
    const removeExecution = useLocalExecution.subscribe(enforceAgentMode);
    return () => {
      removeMisty();
      removeExecution();
    };
  }, []);
  const [bridgeError, setBridgeError] = useState("");
  useEffect(() => {
    if (props.controller === "misty") return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void installMistyContextBridge()
      .then((remove) => {
        if (disposed) remove();
        else cleanup = remove;
      })
      .catch((error) => {
        if (!disposed)
          setBridgeError(error instanceof Error ? error.message : "Misty context could not start.");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [props.controller]);
  return (
    <>
      {bridgeError && (
        <SystemErrorActivity
          accountId={props.accountId}
          error={bridgeError}
          scope="misty:context-bridge"
          title="Misty context could not start"
        />
      )}
      <MistyOverlayControls />
      <GlobalMistySurface {...props} />
      {!props.controller && <GlobalMistySurface {...props} controller="misty" />}
    </>
  );
}
