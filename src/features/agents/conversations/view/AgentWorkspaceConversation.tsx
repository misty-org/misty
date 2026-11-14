import { takeComputerCommand } from "@/features/computer-use/computerUseAttachment";
import { MistyContextBar } from "../composer/MistyContextBar";
import { useGlobalMistyAttachments } from "../composer/useGlobalMistyAttachments";
import { useMistyStore } from "../state/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { useEffect, useRef, useState, type Ref, type ReactNode } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { Text } from "@/shared/ui";
import { useMistyWhileShown } from "../state/useMistyWhileShown";
import { useCompanionState } from "../../tutor/cursor/companionState";
import {
  AgentComposeError,
  AgentReplyTarget,
  conversationInvocationIds,
} from "./AgentComposeNotices";
import { AgentConversationComposer } from "./AgentConversationComposer";
import { AgentConversationTranscript } from "./AgentConversationTranscript";
import { steerRunningTask, submitWorkspaceMessage } from "./conversationSend";
import { useConversationTurnActions } from "./useConversationTurnActions";
import { RewindFilesDialog } from "./RewindFilesDialog";
import { useConversationVoice, type AgentVoiceControl } from "./useConversationVoice";
import { useDraftStatus } from "./useDraftStatus";
import { useFollowLatestMessage } from "./useFollowLatestMessage";
import { replyPrompt } from "./replyQuote";
import { RunStatusStrip } from "./status/RunStatusStrip";
import { ConversationNavigation } from "./navigation/ConversationNavigation";
import { useChatShortcuts } from "./navigation/useChatShortcuts";
import { recordPrompt } from "../composer/promptHistory";
import { usePermissionMode } from "../../plans/permissionMode";
import { AgentQuestionCard } from "../../plans/AgentQuestionCard";
import { WaitingForYouCard } from "../../interventions/WaitingForYouCard";
import { useCollaborationComposer } from "../../plans/useCollaborationComposer";
import { takeBrowserCommand } from "../composer/controls/composerChoices";
import { currentSpaceKey, mistyEngine } from "../../engines/enginesApi";
import { useEngineFolder } from "../composer/controls/FolderSegment";
import { useAgentFolder } from "../../shared-folders/agentFolder";
import { runComposerCommand } from "../composer/commands/engineCommands";
import { CommandReportDialog } from "../composer/commands/CommandReportDialog";
import { EngineQueueChips } from "./engine/EngineQueueChips";
import { EngineHistoryDialog } from "./engine/EngineHistoryDialog";
import { useEngineQueue } from "./engine/engineQueue";
export type { AgentVoiceControl } from "./useConversationVoice";
/**
 * The conversation's column, and the rhythm of the Markdown replies in it: only the person's
 * messages are bubbles, so replies sit on the canvas as plain text at the control size. The
 * paragraph margins win over the Markdown stylesheet's own, except a callout's title.
 */
const conversationClass = [
  "agent-conversation relative flex min-h-0 min-w-0 flex-1 flex-col",
  "[&_.misty-markdown-message]:pt-1 [&_.misty-markdown-message]:text-control",
  "[&_.misty-markdown-message]:leading-[1.6]",
  "[&_.misty-markdown-message_p:not(.misty-markdown-callout-title)]:mt-0!",
  "[&_.misty-markdown-message_p:not(.misty-markdown-callout-title)]:mb-2.5!",
  "[&_.misty-markdown-message_p:not(.misty-markdown-callout-title):last-child]:mb-0!",
].join(" ");

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
  /** Shown under the composer while the chat has no messages, such as ideas to start from. */
  emptyFooter?: ReactNode;
  initialDraft?: string;
  spaceId: string;
  accountId: string;
  onCreate: () => void;
  /** Starts a new chat with this agent, for `/new`. */
  onNewChat?(): void;
  voiceControlRef?: Ref<AgentVoiceControl>;
  onVoiceStateChange?(state: { recording: boolean; busy: boolean }): void;
  onDraftStateChange?: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const spaceId = "";
  // Only what this view shows, and nothing while its tab is hidden; a whole-store subscription
  // re-rendered the transcript on every unrelated store write.
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
  /** The answer, or part of one, the next message responds to. */
  const [reply, setReply] = useState("");
  /** The engine's own history, opened with `/resume`. */
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scoped = state.conversations.filter(
    (c) => c.agentId === agent?.id || (!c.agentId && agent?.system_managed),
  );
  const conversation = scoped.find((c) => c.id === (conversationId ?? state.activeConversationId));
  // The store runs one task at a time; only the conversation that owns it animates.
  const shownWorking =
    state.working &&
    (!state.invocationConversationId || state.invocationConversationId === conversation?.id);
  const permission = usePermissionMode(conversation?.id, agent?.default_run_mode);
  // The folder the chat works in, as the composer reads it, for the commands that need it.
  const outsideEngine = agent?.engine && agent.engine !== mistyEngine ? agent.engine : "";
  const spaceFolder = useEngineFolder(currentSpaceKey(), Boolean(outsideEngine));
  const ownFolder = useAgentFolder(agent);
  const folder = !outsideEngine || ownFolder === undefined ? "" : (ownFolder ?? spaceFolder);
  const reportError = (error: string) =>
    useMistyStore.setState({
      error: error || null,
    });
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
  useChatShortcuts(scrollRef, textareaRef, state.working);
  const prepare = () =>
    useMistyStore.setState({
      selectedAgentId: agent?.id,
      selectedSpaceId: spaceId,
      activeConversationId: conversation?.id ?? "",
      // A pending handoff (a page, selection or folder sent to Misty) belongs
      // to the next message here.
      ...(useMistyStore.getState().handoff ? {} : { handoff: undefined, context: [] }),
    });
  /** The open conversation's id, made first when there is none yet. */
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
  /** `resume`: an answer to a run that handed off, continued on that run's screen. */
  const send = async (
    typed = draft,
    quote = reply,
    targetConversationId?: string,
    resume = false,
  ) => {
    const written = typed;
    // /browser attaches Misty's browser to this message; /plan runs as a command.
    if (!quote) {
      const rest = takeComputerCommand(
        takeBrowserCommand(typed, conversation?.id),
        conversation?.id,
      );
      // `/browser` alone only attaches it, for the message still to be written.
      if (rest !== typed && !rest.trim() && !attachments.attachments.length) {
        setDraft("");
        return;
      }
      typed = rest;
    }
    const onEngine = Boolean(outsideEngine);
    // A `/` command Misty runs: its own, or one of the engine's that only its terminal app runs
    // (`engineCommands.ts`). What it leaves to send goes on as the message.
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
    // An outside engine's turn can't be steered: the message waits for it to end.
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
      // Only what the person typed; a quote or a plan run isn't theirs to recall.
      if (written === draft && written.trim()) recordPrompt(written);
      setDraft("");
      setReply("");
      attachments.consume();
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
        className="agent-conversation-scroll min-h-0 flex-1 overflow-auto overscroll-contain"
        ref={scrollRef}
      >
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
      {/* The transcript's column and gutters, so bubbles line up with the composer. */}
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
          status={
            <EngineQueueChips
              conversationId={conversation?.id}
              working={state.working}
              onEdit={editPrompt}
              onSend={(text) => void send(text, "")}
            />
          }
          empty={!conversation?.messages.length}
        />
        {conversation?.messages.length ? null : emptyFooter}
      </div>
    </section>
  );
}
