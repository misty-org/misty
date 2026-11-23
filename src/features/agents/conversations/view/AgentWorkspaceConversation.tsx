import { takeComputerCommand } from "@/features/computer-use/computer_use_attachment";
import { MistyContextBar } from "../composer/MistyContextBar";
import { useGlobalMistyAttachments } from "../composer/use_global_misty_attachments";
import { useMistyStore } from "../state/use_misty_store";
import type { AgentProfile } from "@/shared/schemas";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";
import { useStableCallback } from "@/shared/hooks/use_stable_callback";
import { PaneLoading, Text } from "@misty/ui";
import { useMistyWhileShown } from "../state/use_misty_while_shown";
import { useCompanionState } from "../../tutor/cursor/companion_state";
import {
  AgentComposeError,
  AgentReplyTarget,
  conversationInvocationIds,
} from "./AgentComposeNotices";
import { AgentConversationComposer } from "./AgentConversationComposer";
import { AgentConversationTranscript } from "./AgentConversationTranscript";
import { steerRunningTask, submitWorkspaceMessage, untilIdle } from "./conversation_send";
import { useConversationTurnActions } from "./use_conversation_turn_actions";
import { RewindFilesDialog } from "./RewindFilesDialog";
import { useConversationVoice, type AgentVoiceControl } from "./use_conversation_voice";
import { useDraftStatus } from "./use_draft_status";
import { useFollowLatestMessage } from "./use_follow_latest_message";
import { replyPrompt } from "./reply_quote";
import { RunStatusStrip } from "./status/RunStatusStrip";
import { PermissionDock } from "./PermissionDock";
import { ConversationNavigation } from "./navigation/ConversationNavigation";
import { useChatShortcuts } from "./navigation/use_chat_shortcuts";
import { recordPrompt } from "../composer/prompt_history";
import { usePermissionMode } from "../../plans/permission_mode";
import { AgentQuestionCard } from "../../plans/AgentQuestionCard";
import { WaitingForYouCard } from "../../interventions/WaitingForYouCard";
import { useCollaborationComposer } from "../../plans/use_collaboration_composer";
import { takeBrowserCommand } from "../composer/controls/composer_choices";
import { mistyEngine } from "../../engines/engines_api";
import { useChatFolder } from "../../shared-folders/chat_folder";
import { runComposerCommand } from "../composer/commands/engine_commands";
import { CommandReportDialog } from "../composer/commands/CommandReportDialog";
import { EngineTodoLane } from "./engine/EngineTodos";
import { EngineQueueChips } from "./engine/EngineQueueChips";
import { EngineHistoryDialog } from "./engine/EngineHistoryDialog";
import { useEngineQueue } from "./engine/engine_queue";
import { syncChat } from "./engine/engine_session_import";
import { localChats, markStoredChats } from "../state/local_chats";
export type { AgentVoiceControl } from "./use_conversation_voice";
import { conversationClass } from "./conversation_class";

export function AgentWorkspaceConversation({
  agent,
  conversationId,
  emptyContent,
  emptyFooter,
  initialDraft = "",
  spaceId: _legacySpaceId,
  accountId,
  onCreate,
  onNewChat,
  onDraftStateChange,
  voiceControlRef,
  onVoiceStateChange,
}: {
  agent?: AgentProfile;
  conversationId?: string;
  emptyContent?: ReactNode;
  emptyFooter?: ReactNode;
  initialDraft?: string;
  spaceId: string;
  accountId: string;
  onCreate: () => void;
  onNewChat?(): void;
  voiceControlRef?: Ref<AgentVoiceControl>;
  onVoiceStateChange?(state: { recording: boolean; busy: boolean }): void;
  onDraftStateChange?: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const spaceId = "";
  const state = useMistyWhileShown((s) => ({
    query: s.query,
    conversations: s.conversations,
    activeConversationId: s.activeConversationId,
    working: s.working,
    conversationsLoading: s.conversationsLoading,
    error: s.error,
    invocationId: s.invocationId,
    invocationConversationId: s.invocationConversationId,
  }));
  const draft = state.query;
  const setDraft = (value: string | ((previous: string) => string)) => {
    const store = useMistyStore.getState();
    store.setQuery(typeof value === "function" ? value(store.query) : value);
  };
  useEffect(() => {
    if (initialDraft && !useMistyStore.getState().query)
      useMistyStore.getState().setQuery(initialDraft);
  }, [initialDraft]);
  const [reply, setReply] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const lastAutoScrolledConversation = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scoped = state.conversations.filter(
    (c) => c.agentId === agent?.id || (!c.agentId && agent?.system_managed),
  );
  const conversation = scoped.find((c) => c.id === (conversationId ?? state.activeConversationId));
  const shownWorking =
    state.working &&
    (!state.invocationConversationId || state.invocationConversationId === conversation?.id);
  const permission = usePermissionMode(conversation?.id, agent?.default_run_mode);
  const outsideEngine = agent?.engine && agent.engine !== mistyEngine ? agent.engine : "";
  const { folder } = useChatFolder(conversation?.id);
  const activeConversationId = conversationId ?? state.activeConversationId;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const reportError = useCallback((error: string) => {
    useMistyStore.setState({ error: error || null });
  }, []);
  const loadOlderMessages = useCallback(async () => {
    const current = useMistyStore
      .getState()
      .conversations.find((item) => item.id === activeConversationId);
    const scroller = scrollRef.current;
    if (!current?.hasOlderMessages || loadingOlderRef.current || !scroller || !accountId) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;
    const anchor = scroller.querySelector<HTMLElement>("[data-message-id]");
    const anchorTop = anchor?.getBoundingClientRect().top;
    try {
      const page = await localChats.messagesPage(accountId, current.id, current.messageBeforeSeq);
      const latest = useMistyStore.getState().conversations.find((item) => item.id === current.id);
      if (!latest) return;
      const loaded = new Set(latest.messages.map((message) => message.id));
      const older = page.messages.filter((message) => !loaded.has(message.id));
      const updated = {
        ...latest,
        messages: [...older, ...latest.messages],
        messageBeforeSeq: page.beforeSeq,
        hasOlderMessages: older.length > 0 && page.hasOlder,
      };
      useMistyStore.setState({
        conversations: useMistyStore
          .getState()
          .conversations.map((item) => (item.id === updated.id ? updated : item)),
      });
      markStoredChats([updated], accountId);
      requestAnimationFrame(() => {
        if (
          scrollRef.current === scroller &&
          activeConversationIdRef.current === updated.id &&
          anchor?.isConnected &&
          anchorTop !== undefined
        ) {
          scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
        } else if (
          scrollRef.current === scroller &&
          activeConversationIdRef.current === updated.id
        ) {
          scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
        }
      });
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : "Older messages couldn't be read.");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [accountId, activeConversationId, reportError]);
  const companion = useCompanionState((s) => s.presentation);
  const voice = useConversationVoice({
    contextKey: `${accountId}:${agent?.id}:${conversation?.id ?? ""}`,
    available: Boolean(agent?.enabled && accountId && !state.working),
    onTranscript: (text) => {
      setDraft((previous) => (previous ? `${previous} ${text}` : text));
      textareaRef.current?.focus();
    },
    onError: reportError,
    controlRef: voiceControlRef,
    onStateChange: onVoiceStateChange,
  });
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(accountId);
    if (accountId && !store.working && !store.conversations.length && !store.conversationsLoading)
      void store.loadConversations();
  }, [accountId]);
  useFollowLatestMessage(scrollRef, conversation?.messages, state.working);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (
      !conversation?.id ||
      !conversation.messages.length ||
      !scroller ||
      scroller.closest("[hidden]") ||
      lastAutoScrolledConversation.current === conversation.id
    )
      return;
    scroller.scrollTop = scroller.scrollHeight;
    lastAutoScrolledConversation.current = conversation.id;
  }, [conversation?.id, conversation?.messages.length]);
  useChatShortcuts(scrollRef, textareaRef, state.working);
  const prepare = () =>
    useMistyStore.setState({
      selectedAgentId: agent?.id,
      selectedSpaceId: spaceId,
      activeConversationId: conversation?.id ?? "",
      ...(useMistyStore.getState().handoff ? {} : { handoff: undefined, context: [] }),
    });
  const ensureConversation = async () => {
    prepare();
    return useMistyStore.getState().newConversation(spaceId);
  };
  const attachments = useGlobalMistyAttachments({
    sharedAccountId: accountId,
    activeConversationId: conversation?.id ?? "",
    newConversation: ensureConversation,
    onError: reportError,
  });
  useDraftStatus(
    Boolean(draft.trim() || attachments.attachments.length),
    voice.recording ||
      voice.requesting ||
      voice.transcribing ||
      attachments.attachments.some((a) => a.state === "uploading"),
    onDraftStateChange,
  );
  const collaboration = useCollaborationComposer({
    accountId,
    conversationId: conversation?.id,
    clearDraft: () => setDraft(""),
  });
  const { questions, proposedPlan } = collaboration;
  const send = async (
    typed = draft,
    quote = reply,
    targetConversationId?: string,
    resume = false,
  ) => {
    const written = typed;
    if (!quote) {
      const rest = takeComputerCommand(
        takeBrowserCommand(typed, conversation?.id),
        conversation?.id,
      );
      if (rest !== typed && !rest.trim() && !attachments.attachments.length) {
        setDraft("");
        return;
      }
      typed = rest;
    }
    const onEngine = Boolean(outsideEngine);
    let after: (() => Promise<void>) | undefined;
    if (!quote && typed.trim().startsWith("/")) {
      let ran;
      try {
        ran = await runComposerCommand(typed, {
          accountId,
          engine: outsideEngine || mistyEngine,
          conversationId: conversation?.id,
          folder,
          messages: conversation?.messages ?? [],
          working: state.working,
          newChat: onNewChat,
          openHistory: () => setHistoryOpen(true),
          stop: async () => {
            await useMistyStore.getState().cancelResponse?.();
          },
          plan: (text) => collaboration.command(text),
        });
      } catch (error) {
        reportError(error instanceof Error ? error.message : String(error));
        return;
      }
      if (ran === null) {
        setDraft("");
        return;
      }
      if (ran) {
        typed = ran.send;
        after = ran.after;
        if (ran.conversationId && ran.conversationId !== conversation?.id) {
          setDraft("");
          void send(ran.send, "", ran.conversationId);
          return;
        }
      }
    }
    const prompt = quote && typed.trim() ? replyPrompt(quote, typed) : typed;
    const targetId = targetConversationId ?? conversation?.id ?? "";
    if (
      !agent?.enabled ||
      attachments.attachments.some((a) => a.state !== "ready") ||
      (!prompt.trim() && !attachments.attachments.length)
    )
      return;
    if (state.working && onEngine && conversation?.id && !attachments.attachments.length) {
      useEngineQueue.getState().add(conversation.id, prompt);
      setDraft("");
      setReply("");
      return;
    }
    if (state.working) {
      await steerRunningTask(accountId, state.invocationId, prompt, conversation?.id).catch(
        (error: unknown) => reportError(error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    prepare();
    try {
      await submitWorkspaceMessage(prompt, attachments.attachments, targetId, resume, companion);
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!useMistyStore.getState().error) {
      if (written === draft && written.trim()) recordPrompt(written);
      setDraft("");
      setReply("");
      attachments.consume();
      if (after) {
        await untilIdle();
        await after().catch((error: unknown) =>
          reportError(error instanceof Error ? error.message : String(error)),
        );
      }
    }
  };
  const { retryPrompt, resumeLedger, changeLedger, filesAsk, chooseFiles } =
    useConversationTurnActions(
      conversation,
      (prompt, resume) => void send(prompt, "", undefined, resume),
      reportError,
    );
  const editPrompt = useStableCallback((text: string) => {
    setDraft(text);
    textareaRef.current?.focus();
  });
  const replyTo = useStableCallback((quote: string) => {
    setReply(quote);
    textareaRef.current?.focus();
  });
  return (
    <section
      className={conversationClass}
      data-empty={!conversation?.messages.length}
      aria-label={`${agent?.name || "Misty"} conversation`}
    >
      <div
        className="agent-conversation-scroll misty-scrollbar-flush min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none]"
        ref={scrollRef}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 72) void loadOlderMessages();
        }}
      >
        {loadingOlder ? <PaneLoading label="Loading older messages" inline /> : null}
        <AgentConversationTranscript
          view={{
            conversation,
            working: shownWorking,
            onRetry: retryPrompt,
            onResume: resumeLedger,
            onLedgerChange: changeLedger,
            onEdit: editPrompt,
            onReply: replyTo,
          }}
          plan={proposedPlan}
          planHistory={collaboration.state?.planHistory}
          onRunPlan={(prompt) => void send(prompt, "")}
          onKeepPlanning={() => textareaRef.current?.focus()}
          emptyContent={emptyContent}
          showCreate={!agent && !state.conversationsLoading}
          onCreate={onCreate}
        />
      </div>
      <RewindFilesDialog plan={filesAsk} onChoose={chooseFiles} />
      <ConversationNavigation
        conversationId={conversation?.id}
        messages={conversation?.messages}
        scrollRef={scrollRef}
      />
      <div className="agent-compose-area mx-auto w-full max-w-209 shrink-0 px-6 pt-3 pb-4">
        <AgentComposeError
          error={state.error}
          reconnect={state.working && Boolean(state.invocationId)}
          dismiss={() => reportError("")}
        />
        {agent && !agent.enabled && (
          <Text wrap size="caption" tone="muted" className="mt-1.5 mb-0">
            This agent is disabled. Enable it in Settings to start a conversation.
          </Text>
        )}
        <MistyContextBar />
        <WaitingForYouCard
          accountId={accountId}
          agentName={agent?.name || "Misty"}
          invocationIds={conversationInvocationIds(
            conversation,
            state.invocationConversationId === conversation?.id ? state.invocationId : undefined,
          )}
          revision={`${state.working}:${state.invocationId ?? ""}`}
        />
        {questions && (
          <AgentQuestionCard
            questionSet={questions}
            agentName={agent?.name || "Misty"}
            onContinue={(prompt) => void send(prompt, "", undefined, true)}
          />
        )}
        <RunStatusStrip conversationId={conversation?.id} messages={conversation?.messages} />
        <CommandReportDialog />
        {agent?.engine && agent.engine !== mistyEngine ? (
          <EngineHistoryDialog
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            engine={agent.engine}
            agentId={agent.id}
            conversationId={conversation?.id}
          />
        ) : null}
        <PermissionDock agentId={agent?.id} />
        <AgentReplyTarget
          agentName={agent?.name || "Misty"}
          reply={reply}
          cancel={() => setReply("")}
        />
        <AgentConversationComposer
          agent={agent}
          accountId={accountId}
          conversationId={conversation?.id}
          draft={draft}
          setDraft={setDraft}
          textareaRef={textareaRef}
          attachments={attachments}
          voice={voice}
          collaboration={collaboration}
          permission={permission}
          working={state.working}
          send={() => void send()}
          reportError={reportError}
          onOpenHistory={() => setHistoryOpen(true)}
          onSync={() => {
            if (!conversation?.id) return;
            void syncChat(conversation.id).catch((error: unknown) =>
              reportError(error instanceof Error ? error.message : String(error)),
            );
          }}
          status={
            <>
              <EngineTodoLane
                runId={
                  state.working && state.invocationConversationId === conversation?.id
                    ? state.invocationId
                    : undefined
                }
              />
              <EngineQueueChips
                conversationId={conversation?.id}
                working={state.working}
                onEdit={editPrompt}
                onSend={(text) => void send(text, "")}
              />
            </>
          }
          empty={!conversation?.messages.length}
        />
        {conversation?.messages.length ? null : emptyFooter}
      </div>
    </section>
  );
}
