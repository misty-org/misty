import { MistyContextBar } from "@/features/misty/MistyContextBar";
import { MistyFolderWork } from "@/features/misty/MistyFolderWork";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { useGlobalMistyAttachments } from "@/features/global-search/useGlobalMistyAttachments";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, IconButton, Spinner } from "@/shared/ui";
import { Mic, Reply, Square, X } from "lucide-react";
import { useEffect, useRef, useImperativeHandle, useState, type Ref, type ReactNode } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useShallow } from "zustand/react/shallow";
import { useCompanionState } from "../companion/companionState";
import { AgentConversationView } from "./AgentConversationView";
import { replyPrompt } from "./replyQuote";
import { AgentControlBar } from "../workspace/AgentControlBar";
import { AgentUsageControl } from "../workspace/AgentUsageControl";
import { ConversationModelPicker } from "../models/ConversationModelPicker";
import { AgentModeToggle } from "../collaboration/AgentModeToggle";
import { AgentPlanCard } from "../collaboration/AgentPlanCard";
import { AgentQuestionCard } from "../collaboration/AgentQuestionCard";
import { useCollaborationComposer } from "../collaboration/useCollaborationComposer";
export type AgentVoiceControl = { toggle(): void };
export function AgentWorkspaceConversation({
  agent,
  conversationId,
  emptyContent,
  belowComposer,
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
  /** Shown under the composer while the conversation is empty. */
  belowComposer?: ReactNode;
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
  const reportError = (error: string) =>
    useMistyStore.setState({
      error: error || null,
    });
  const companion = useCompanionState((s) => s.presentation);
  const isDesktop = hasTauriInternals() && /Mac|Win/.test(navigator.platform);
  const voice = useAiVoiceRecorder({
    contextKey: `${accountId}:${agent?.id}:${conversation?.id ?? ""}`,
    onTranscript: (text) => {
      setDraft((previous) => (previous ? `${previous} ${text}` : text));
      textareaRef.current?.focus();
    },
    onError: reportError,
  });
  useImperativeHandle(voiceControlRef, () => ({
    toggle() {
      if (!agent?.enabled || !accountId || state.working || voice.requesting || voice.transcribing)
        return;
      if (voice.recording) voice.stop();
      else void voice.start();
    },
  }));
  useEffect(() => {
    onVoiceStateChange?.({
      recording: voice.recording,
      busy: voice.requesting || voice.transcribing,
    });
  }, [voice.recording, voice.requesting, voice.transcribing, onVoiceStateChange]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(accountId);
    if (accountId && !store.working && !store.conversations.length && !store.conversationsLoading)
      void store.loadConversations();
  }, [accountId]);
  useEffect(() => {
    // On the Agents page the chat column scrolls, so follow that instead of the transcript.
    const view = scrollRef.current?.closest<HTMLElement>("[data-scroll-root]") ?? scrollRef.current;
    if (
      conversation?.messages.length &&
      view &&
      view.scrollHeight - view.scrollTop - view.clientHeight < 220
    )
      view.scrollTop = view.scrollHeight;
  }, [conversation?.messages, state.working]);
  const prepare = () =>
    useMistyStore.setState({
      selectedAgentId: agent?.id,
      selectedSpaceId: spaceId,
      activeConversationId: conversation?.id ?? "",
      ...(useMistyStore.getState().handoff?.surfaceId === "files"
        ? {}
        : { handoff: undefined, browserRequest: undefined, context: [] }),
    });
  const attachments = useGlobalMistyAttachments({
    sharedAccountId: accountId,
    mode: "ask",
    activeConversationId: conversation?.id ?? "",
    newConversation: async () => {
      prepare();
      return useMistyStore.getState().newConversation(spaceId);
    },
    setMode: () => {},
    onError: reportError,
  });
  const hasDraft = Boolean(draft.trim() || attachments.attachments.length);
  const composingBusy =
    voice.recording ||
    voice.requesting ||
    voice.transcribing ||
    attachments.attachments.some((a) => a.state === "uploading");
  useEffect(() => {
    onDraftStateChange?.({
      dirty: hasDraft,
      busy: composingBusy,
    });
    return () =>
      onDraftStateChange?.({
        dirty: false,
        busy: false,
      });
  }, [hasDraft, composingBusy, onDraftStateChange]);
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
  const { planning, questions, proposedPlan } = collaboration;
  const send = async (typed = draft, quote = reply, targetConversationId?: string) => {
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
      try {
        await useMistyStore.getState().steerResponse?.(prompt, conversation?.id);
      } catch (error) {
        reportError(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    prepare();
    try {
      if (isDesktop && useMistyStore.getState().handoff?.surfaceId !== "files") {
        const submit = useCompanionState.getState().submit;
        if (!submit) throw new Error("The companion is starting. Try again in a moment.");
        await submit({
          prompt,
          attachments: attachments.attachments,
          conversationId: targetId,
        });
      } else {
        await useMistyStore
          .getState()
          .submitAnswer(
            prompt,
            attachments.attachments,
            undefined,
            "workspace",
            [],
            { conversationId: targetId, context: [] },
            { executionMode: "user", interactionMode: companion.mode, model: companion.model },
          );
      }
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
  // Stable, so the memoized transcript skips re-rendering while the person types.
  const retryPrompt = useStableCallback((prompt: string) => void send(prompt, ""));
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
        {conversation?.messages.length ? (
          <>
            <AgentConversationView
              conversation={conversation}
              working={state.working}
              onRetry={retryPrompt}
              onEdit={editPrompt}
              onReply={replyTo}
            />
            {proposedPlan && (
              <div className="agent-plan-slot">
                <AgentPlanCard
                  plan={proposedPlan}
                  history={collaboration.state?.planHistory}
                  working={state.working}
                  onRun={(prompt) => void send(prompt, "")}
                  onKeepPlanning={() => textareaRef.current?.focus()}
                />
              </div>
            )}
          </>
        ) : emptyContent ? (
          emptyContent
        ) : !agent && !state.conversationsLoading ? (
          <div className="agent-empty-state">
            <Button variant="secondary" onClick={onCreate}>
              Create an agent
            </Button>
          </div>
        ) : null}
      </div>
      <div className="agent-compose-area">
        {state.error && (
          <div role="alert" className="agent-compose-error">
            <p>{state.error}</p>
            {state.working && state.invocationId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void useMistyStore.getState().loadConversations(true)}
              >
                Reconnect to task
              </Button>
            )}
            <IconButton label="Dismiss error" onClick={() => reportError("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
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
        {questions && (
          <AgentQuestionCard
            questionSet={questions}
            agentName={agent?.name || "Misty"}
            onContinue={(prompt) => void send(prompt, "")}
          />
        )}
        {reply && (
          <div className="agent-reply-target">
            <Reply size={14} aria-hidden="true" />
            <p>
              <span>Replying to {agent?.name || "Misty"}</span> {reply}
            </p>
            <IconButton size="xs" label="Cancel reply" onClick={() => setReply("")}>
              <X />
            </IconButton>
          </div>
        )}
        <MistyComposer
          hideUsageEstimate={showControlBar && Boolean(agent)}
          modelId={conversation?.modelId}
          // One toolbar under the text: Attach and the mode on the left; the model,
          // usage, voice and send on the right.
          leadingControl={
            <AgentModeToggle conversationId={conversation?.id} mode={collaboration.mode} />
          }
          layout="conversation"
          value={draft}
          onChange={setDraft}
          mode="ask"
          textareaRef={textareaRef}
          attachments={attachments.attachments}
          maxAttachments={4}
          onAddFiles={attachments.addFiles}
          onRemoveAttachment={attachments.remove}
          onSubmit={() => void send()}
          onError={reportError}
          onKeyDown={(e) => {
            if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              // Shift+Tab switches between Plan and Act, as in other agent tools.
              e.preventDefault();
              collaboration.toggleMode();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!attachments.attachments.some((a) => a.state !== "ready")) void send();
            }
          }}
          placeholder={
            planning ? `Plan with ${agent?.name || "Misty"}…` : `Message ${agent?.name || "Misty"}…`
          }
          disabled={!agent?.enabled || !accountId}
          busy={state.working && !draft.trim()}
          voiceControl={
            <>
              <ConversationModelPicker
                conversation={conversation}
                disabled={state.working}
                onError={reportError}
              />
              {showControlBar && agent && (
                <AgentUsageControl
                  draft={draft}
                  model={conversation?.modelId}
                  working={state.working}
                />
              )}
              <IconButton
                label={voice.recording ? "Stop recording" : "Start voice input"}
                disabled={
                  !agent?.enabled ||
                  !accountId ||
                  state.working ||
                  voice.requesting ||
                  voice.transcribing
                }
                onClick={() => (voice.recording ? voice.stop() : void voice.start())}
              >
                {voice.requesting || voice.transcribing ? (
                  <Spinner size="lg" label={false} />
                ) : voice.recording ? (
                  <Square size={16} />
                ) : (
                  <Mic size={18} />
                )}
              </IconButton>
            </>
          }
          trailingControl={
            state.working ? (
              <IconButton
                label="Stop response"
                onClick={() => {
                  void useMistyStore
                    .getState()
                    .cancelResponse?.()
                    .catch((e) => reportError(String(e)));
                }}
              >
                <Square size={16} />
              </IconButton>
            ) : undefined
          }
        />
        {/* The transcript shows its own working status once it has messages. */}
        {((state.working && !conversation?.messages.length) ||
          voice.recording ||
          voice.transcribing) && (
          <p className="agent-compose-status" role="status">
            {voice.recording
              ? "Listening…"
              : voice.transcribing
                ? "Transcribing…"
                : `${agent?.name || "Misty"} is working…`}
          </p>
        )}
        {!conversation?.messages.length && belowComposer}
      </div>
    </section>
  );
}
