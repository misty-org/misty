import { setBrowserWebviewsSuspended } from "@/features/browser";
import { SystemErrorActivity } from "@/features/activity";
import { MistyRegionCapture, useAiSurfaceStore, useAiVoiceRecorder } from "@/features/ai-surface";
import { useExplorerStore } from "@/features/files/explorer";
import { invokeShortcutCommand } from "@/features/shortcuts";
import { useWorkspaceStore } from "@/features/workspace";
import { ScrollArea, cn } from "@/shared/ui";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { GlobalMistyComposerBar, GlobalMistyVoiceIsland } from "./GlobalMistyChrome";
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

const panelClass = [
  "pointer-events-auto flex max-h-[min(680px,calc(100dvh-120px))]",
  "w-[min(820px,calc(100dvw-48px))] flex-col overflow-hidden rounded-2xl will-change-transform",
  "border border-white/10 bg-charcoal-card/95 text-cream backdrop-blur-2xl",
].join(" ");
const panelShadowClass = "shadow-[0_28px_90px_rgba(0,0,0,0.62)]";

export function GlobalMisty(props: {
  accountId: string;
  currentPath: string;
  activePaneId: string;
  activePanePath: string;
  includeCurrentContext?: boolean;
  allowCapture?: boolean;
  suspendBrowserWebviews?: boolean;
  onNavigate?: (href: string) => void;
  onCommand?: (commandId?: string, tabId?: string) => void;
  onClosed?: () => void;
  showShadow?: boolean;
  onRequestDrag?: () => void;
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
    onRequestDrag,
    onContentVisibilityChange,
    onVoiceActivityChange,
  } = props;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
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
    context,
    conversations,
    conversationsLoading,
    activeConversationId,
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
  } = useGlobalSearchStore(
    useShallow((state) => ({
      panel: state.panel,
      mode: state.mode,
      query: state.query,
      results: state.results,
      searching: state.searching,
      working: state.working,
      error: state.error,
      context: state.context,
      conversations: state.conversations,
      conversationsLoading: state.conversationsLoading,
      activeConversationId: state.activeConversationId,
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
  const pane = useExplorerStore((state) => state.panes[props.activePaneId]);
  const aiRegistration = useAiSurfaceStore((state) =>
    Object.values(state.registrations).find(
      (registration) => registration.paneId === props.activePaneId,
    ),
  );
  const registeredAiContext = useMemo(
    () => aiRegistration?.adapter.getContext() ?? [],
    [aiRegistration],
  );
  const registeredAiSelection = aiRegistration?.adapter.getSelection?.() ?? null;
  const currentContext = useMemo(
    () =>
      !includeCurrentContext
        ? []
        : contextForCurrentView(props.currentPath, props.activePanePath, pane, registeredAiContext),
    [includeCurrentContext, pane, props.activePanePath, props.currentPath, registeredAiContext],
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
          ? candidate.type !== "answer" && candidate.type !== "agent_task"
          : candidate.type === "answer" || candidate.type === "agent_task",
    );
  }, [activeMode, attachments.length, filters, query, results]);
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((candidate) => candidate.id === selectedCandidateId),
  );
  const conversation = conversations.find((item) => item.id === activeConversationId);
  const open = panel !== "closed";
  const conversationActive = panel === "answer" || panel === "agent";
  const contentVisible = hasQuery || conversationActive;
  const wasOpenRef = useRef(false);
  const voice = useAiVoiceRecorder({
    onTranscript: (transcript) => {
      const current = useGlobalSearchStore.getState().query.trim();
      useGlobalSearchStore.getState().setQuery(`${current}${current ? " " : ""}${transcript}`);
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
    setContext(mergeGlobalMistyContext(useGlobalSearchStore.getState().context, currentContext));
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [currentContext, open, setContext]);
  useEffect(() => {
    if (!open || activeMode !== "ask") return;
    const state = useGlobalSearchStore.getState();
    if (!state.conversations.length && !state.conversationsLoading) void loadConversations();
  }, [activeMode, loadConversations, open]);
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel, open]);
  useEffect(() => {
    if (!suspendBrowserWebviews) return;
    setBrowserWebviewsSuspended(open, "global-misty");
    return () => setBrowserWebviewsSuspended(false, "global-misty");
  }, [open, suspendBrowserWebviews]);
  useEffect(() => {
    if (wasOpenRef.current && !open) onClosed?.();
    wasOpenRef.current = open;
  }, [onClosed, open]);
  useEffect(() => {
    if (open) onContentVisibilityChange?.(contentVisible);
  }, [contentVisible, onContentVisibilityChange, open]);

  const activateCandidate = (candidate?: UnifiedMistyCandidate) => {
    if (!candidate || working) return;
    if (candidate.type === "object" || candidate.type === "navigation") {
      void resultActions.openResult(candidate.result);
      return;
    }
    if (candidate.type === "answer") {
      void submitAnswer(
        candidate.prompt,
        attachmentState.consume(),
        registeredAiSelection ?? undefined,
      );
      return;
    }
    if (candidate.type === "agent_task") {
      void submitAgentTask(candidate.prompt, props.activePaneId);
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
        void submitAnswer(query, attachmentState.consume(), registeredAiSelection ?? undefined);
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

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onRequestDrag || event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("input, textarea, button, a, [role='button']")) return;
    event.preventDefault();
    onRequestDrag();
  };

  const composer = (
    <GlobalMistyComposerBar
      query={query}
      onQuery={setQuery}
      mode={activeMode}
      conversationActive={conversationActive}
      textareaRef={inputRef}
      attachments={attachments}
      onModeChange={attachmentState.changeMode}
      onAddFiles={attachmentState.addFiles}
      onRemoveAttachment={attachmentState.remove}
      onSubmit={() => {
        if (activeMode === "ask") {
          void submitAnswer(query, attachmentState.consume(), registeredAiSelection ?? undefined);
        } else activateCandidate(candidates[selectedIndex] ?? candidates[0]);
      }}
      onKeyDown={onInputKeyDown}
      onCapture={allowCapture ? () => setCapturingRegion(true) : undefined}
      busy={searching || working}
      working={working}
      conversation={conversation}
      activeConversationId={activeConversationId}
      voice={voice}
      onError={setVoiceError}
      onClose={closePanel}
      onRequestDrag={onRequestDrag}
      onPointerDown={onHeaderPointerDown}
      onModelChange={(settings) =>
        useGlobalSearchStore.setState((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === activeConversationId ? { ...item, ...settings } : item,
          ),
        }))
      }
    />
  );

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[2147482500] flex flex-col items-center pt-[9vh]"
      data-global-misty-root
    >
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
              ref={panelRef}
              key="unified-misty"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              className="pointer-events-none flex origin-center flex-col items-center gap-2"
              data-html2canvas-ignore="true"
            >
              {conversationActive ? (
                <GlobalMistyVoiceIsland
                  voice={voice}
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  loading={conversationsLoading}
                  mode={mode}
                  onModeChange={attachmentState.changeMode}
                  onSelect={selectConversation}
                  onNew={() => void newConversation()}
                  onDelete={(id) => void deleteConversation(id)}
                  onRename={(id, title) => void renameConversation(id, title)}
                  onClose={closePanel}
                  onRequestDrag={onRequestDrag}
                  onPointerDown={onHeaderPointerDown}
                />
              ) : null}
              <section
                className={cn(
                  panelClass,
                  conversationActive && "h-[min(640px,calc(100dvh-120px))]",
                  showShadow && panelShadowClass,
                )}
                aria-label="Misty Search"
                data-misty-conversation={conversationActive ? "true" : undefined}
              >
                {conversationActive ? (
                  <>
                    <ContextReceipt
                      context={context.filter((item) => item.attached)}
                      selection={registeredAiSelection ?? undefined}
                      onRemove={removeContext}
                    />
                    <div className="min-h-0 flex-1 border-b border-white/10">
                      <ScrollArea className="h-full" data-misty-conversation-scroll>
                        <ConversationView
                          conversation={conversation}
                          working={working}
                          onConfirm={(id) => void approveAgentTask(id)}
                          onReject={rejectAction}
                          onCancel={(id) => void cancelAgentTask(id)}
                        />
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
                      <div className="min-h-0 border-t border-charcoal-border/70">
                        <ScrollArea className="h-[min(500px,calc(100dvh-270px))]">
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
        <MistyRegionCapture
          onCancel={() => setCapturingRegion(false)}
          onCapture={(nextCapture) => {
            setCapturingRegion(false);
            void attachmentState.addFiles([captureToFile(nextCapture)]);
          }}
        />
      ) : null}
    </div>
  );
}
