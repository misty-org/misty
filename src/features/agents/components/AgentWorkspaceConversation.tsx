import { aiSurfaceApi } from "@/features/ai-surface/api";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { useGlobalMistyAttachments } from "@/features/global-search/useGlobalMistyAttachments";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, IconButton, Spinner } from "@/shared/ui";
import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState, useImperativeHandle, type Ref, type ReactNode } from "react";
import { useCompanionState } from "../companion/companionState";
import { AgentConversationView } from "./AgentConversationView";
export type AgentVoiceControl = { toggle(): void };
export function AgentWorkspaceConversation({
  agent,
  conversationId,
  emptyContent,
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
  spaceId: string;
  accountId: string;
  onCreate: () => void;
  voiceControlRef?: Ref<AgentVoiceControl>;
  onVoiceStateChange?(state: { recording: boolean; busy: boolean }): void;
  onDraftStateChange?: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const spaceId = "";
  const state = useMistyStore();
  const [draft, setDraft] = useState("");
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
    const view = scrollRef.current;
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
      handoff: undefined,
      browserRequest: undefined,
      context: [],
    });
  const attachments = useGlobalMistyAttachments({
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
  const send = async (prompt = draft) => {
    if (
      state.working ||
      !agent?.enabled ||
      attachments.attachments.some((a) => a.state !== "ready") ||
      (!prompt.trim() && !attachments.attachments.length)
    )
      return;
    prepare();
    try {
      if (isDesktop) {
        const submit = useCompanionState.getState().submit;
        if (!submit) throw new Error("The companion is starting. Try again in a moment.");
        await submit({
          prompt,
          attachments: attachments.attachments,
          conversationId: conversation?.id ?? "",
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
            { conversationId: conversation?.id ?? "", context: [] },
            { executionMode: "user", interactionMode: companion.mode, model: companion.model },
          );
      }
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!useMistyStore.getState().error) {
      setDraft("");
      attachments.consume();
    }
  };
  return (
    <section className="agent-conversation" aria-label={`${agent?.name || "Misty"} conversation`}>
      <div className="agent-conversation-scroll" ref={scrollRef}>
        {conversation?.messages.length ? (
          <AgentConversationView
            conversation={conversation}
            working={state.working}
            onConfirm={(id) => void state.confirmAction(id)}
            onReject={state.rejectAction}
            onCancel={(id) => void state.cancelAgentTask(id)}
            onRetry={(prompt) => void send(prompt)}
          />
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
        <MistyComposer
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
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!attachments.attachments.some((a) => a.state !== "ready")) void send();
            }
          }}
          placeholder={`Message ${agent?.name || "Misty"}…`}
          disabled={!agent?.enabled || !accountId}
          busy={state.working}
          voiceControl={
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
          }
          trailingControl={
            state.working ? (
              <IconButton
                label="Stop response"
                onClick={() => {
                  if (state.invocationId)
                    void aiSurfaceApi
                      .cancelInvocation(state.invocationId)
                      .catch((e) => reportError(String(e)));
                }}
              >
                <Square size={16} />
              </IconButton>
            ) : undefined
          }
        />
        {(state.working || voice.recording || voice.transcribing) && (
          <p className="agent-compose-status" role="status">
            {voice.recording
              ? "Listening…"
              : voice.transcribing
                ? "Transcribing…"
                : `${agent?.name || "Misty"} is working…`}
          </p>
        )}
      </div>
    </section>
  );
}
