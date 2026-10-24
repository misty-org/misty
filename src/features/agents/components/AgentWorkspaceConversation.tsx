// Its frame styles travel with it, so any page that hosts the conversation gets them.
import "../agentsWorkspace.css";
import "../workspace/agentWorkspaceFrame.css";
import { MistyContextBar } from "@/features/misty/MistyContextBar";
import { MistyFolderWork } from "@/features/misty/MistyFolderWork";
import { useGlobalMistyAttachments } from "@/features/misty/useGlobalMistyAttachments";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { useEffect, useRef, useState, type Ref, type ReactNode } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useShallow } from "zustand/react/shallow";
import { useCompanionState } from "../companion/companionState";
import {
  AgentComposeError,
  AgentReplyTarget,
  conversationInvocationIds,
} from "./AgentComposeNotices";
import { AgentConversationComposer } from "./AgentConversationComposer";
import { AgentConversationTranscript } from "./AgentConversationTranscript";
import { steerRunningTask, submitWorkspaceMessage } from "./conversationSend";
import { useConversationTurnActions } from "./useConversationTurnActions";
import { useConversationVoice, type AgentVoiceControl } from "./useConversationVoice";
import { useDraftStatus } from "./useDraftStatus";
import { useFollowLatestMessage } from "./useFollowLatestMessage";
import { replyPrompt } from "./replyQuote";
import { AgentControlBar } from "../workspace/AgentControlBar";
import { usePermissionMode } from "../collaboration/permissionMode";
import { AgentQuestionCard } from "../collaboration/AgentQuestionCard";
import { WaitingForYouCard } from "@/features/agent-interventions/WaitingForYouCard";
import { useCollaborationComposer } from "../collaboration/useCollaborationComposer";
export type { AgentVoiceControl } from "./useConversationVoice";
export function AgentWorkspaceConversation({
  agent,
  conversationId,
  emptyContent,
  initialDraft = "",
  showControlBar = false,
  spaceId: _legacySpaceId,
  accountId,
  onCreate,
  onDraftStateChange,
  voiceControlRef,
  onVoiceStateChange,
}: {
  agent?: AgentProfile;
  conversationId?: string;
  emptyContent?: ReactNode;
  initialDraft?: string;
  showControlBar?: boolean;
  spaceId: string;
  accountId: string;
  onCreate: () => void;
  voiceControlRef?: Ref<AgentVoiceControl>;
  onVoiceStateChange?(state: { recording: boolean; busy: boolean }): void;
  onDraftStateChange?: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const spaceId = "";
  // Only what this view shows; a whole-store subscription re-rendered the transcript on
  // every unrelated store write.
  const state = useMistyStore(
    useShallow((s) => ({
      query: s.query,
      conversations: s.conversations,
      activeConversationId: s.activeConversationId,
      working: s.working,
      conversationsLoading: s.conversationsLoading,
      error: s.error,
      invocationId: s.invocationId,
      invocationConversationId: s.invocationConversationId,
    })),
  );
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
  const prepare = () =>
    useMistyStore.setState({
      selectedAgentId: agent?.id,
      selectedSpaceId: spaceId,
      activeConversationId: conversation?.id ?? "",
      // A pending handoff (a page, selection or folder sent to Misty) belongs
      // to the next message here.
      ...(useMistyStore.getState().handoff
        ? {}
        : { handoff: undefined, browserRequest: undefined, context: [] }),
    });
  const attachments = useGlobalMistyAttachments({
    sharedAccountId: accountId,
    activeConversationId: conversation?.id ?? "",
    newConversation: async () => {
      prepare();
      return useMistyStore.getState().newConversation(spaceId);
    },
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
    working: state.working,
    send: (prompt, id) => void send(prompt, "", id),
    ensureConversation: async () => {
      prepare();
      return useMistyStore.getState().newConversation(spaceId);
    },
    clearDraft: () => setDraft(""),
    reportError,
  });
  const { questions, proposedPlan } = collaboration;
  /** `resume`: an answer to a run that handed off, continued on that run's screen. */
  const send = async (
    typed = draft,
    quote = reply,
    targetConversationId?: string,
    resume = false,
  ) => {
    // /plan and /goal run as commands rather than messages.
    if (!quote && !state.working && typed.trim().startsWith("/")) {
      const rewritten = await collaboration.command(typed);
      if (rewritten === undefined) return;
      typed = rewritten;
    }
    const prompt = quote && typed.trim() ? replyPrompt(quote, typed) : typed;
    const targetId = targetConversationId ?? conversation?.id ?? "";
    if (
      !agent?.enabled ||
      attachments.attachments.some((a) => a.state !== "ready") ||
      (!prompt.trim() && !attachments.attachments.length)
    )
      return;
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
      setDraft("");
      setReply("");
      attachments.consume();
    }
  };
  const { retryPrompt, resumeLedger, changeLedger } = useConversationTurnActions(
    conversation,
    (prompt, resume) => void send(prompt, "", undefined, resume),
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
      className="agent-conversation"
      data-empty={!conversation?.messages.length}
      aria-label={`${agent?.name || "Misty"} conversation`}
    >
      <div className="agent-conversation-scroll" ref={scrollRef}>
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
      <div className="agent-compose-area">
        <AgentComposeError
          error={state.error}
          reconnect={state.working && Boolean(state.invocationId)}
          dismiss={() => reportError("")}
        />
        {agent && !agent.enabled && (
          <p className="agent-compose-hint">
            This agent is disabled. Enable it in Settings to start a conversation.
          </p>
        )}
        <MistyContextBar />
        {showControlBar && agent ? (
          <AgentControlBar>
            <MistyFolderWork accountId={accountId} disabled={state.working} hideIdle />
          </AgentControlBar>
        ) : (
          <MistyFolderWork accountId={accountId} disabled={state.working} />
        )}
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
        <AgentReplyTarget
          agentName={agent?.name || "Misty"}
          reply={reply}
          cancel={() => setReply("")}
        />
        <AgentConversationComposer
          agent={agent}
          accountId={accountId}
          conversationId={conversation?.id}
          modelId={conversation?.modelId}
          draft={draft}
          setDraft={setDraft}
          textareaRef={textareaRef}
          attachments={attachments}
          voice={voice}
          collaboration={collaboration}
          permission={permission}
          working={state.working}
          showControlBar={showControlBar}
          send={() => void send()}
          reportError={reportError}
        />
      </div>
    </section>
  );
}
