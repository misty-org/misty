import { aiSurfaceApi } from "@/features/ai-surface/api";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { useGlobalMistyAttachments } from "@/features/global-search/useGlobalMistyAttachments";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, IconButton, Input, Pressable, Spinner } from "@/shared/ui";
import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentCompanionPanel } from "../companion/AgentCompanionPanel";
import { useCompanionState } from "../companion/companionState";
import { AgentConversationView } from "./AgentConversationView";
const suggestions = [
  [
    "Catch me up on my projects",
    "Help me catch up on my current projects and identify what needs attention.",
  ],
  ["Plan my next steps", "Help me make a practical plan for what I’m working on."],
  [
    "Turn an idea into a draft",
    "Help me turn an idea into a clear first draft. Ask me what I have in mind.",
  ],
  [
    "Think through a decision",
    "Help me think through a decision. Ask me about the options and what matters most.",
  ],
];
export function AgentWorkspaceConversation({
  agent,
  spaceId: _legacySpaceId,
  accountId,
  onCreate,
  userName,
  onDraftStateChange,
}: {
  agent?: AgentProfile;
  spaceId: string;
  accountId: string;
  onCreate: () => void;
  userName?: string;
  onDraftStateChange?: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const spaceId = "";
  const state = useMistyStore();
  const [draft, setDraft] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scoped = state.conversations.filter(
    (c) => c.agentId === agent?.id || (!c.agentId && agent?.system_managed),
  );
  const conversation = scoped.find((c) => c.id === state.activeConversationId);
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
  const [openedAt] = useState(() => new Date());
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(accountId);
    if (accountId && !store.working && !store.conversations.length && !store.conversationsLoading)
      void store.loadConversations();
  }, [accountId]);
  useEffect(() => {
    const view = scrollRef.current;
    if (view && view.scrollHeight - view.scrollTop - view.clientHeight < 220)
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
    await useMistyStore.getState().submitAnswer(
      prompt,
      attachments.attachments,
      undefined,
      "workspace",
      [],
      {
        conversationId: conversation?.id ?? "",
        context: [],
      },
      {
        executionMode: isDesktop ? "agent" : "user",
        interactionMode: companion.mode,
        model: companion.model,
      },
    );
    if (!useMistyStore.getState().error) {
      setDraft("");
      attachments.consume();
    }
  };
  return (
    <section className="agent-conversation" aria-label={`${agent?.name || "Misty"} conversation`}>
      <AgentCompanionPanel />
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
        ) : (
          <div className="agent-welcome">
            <time className="agent-conversation-date" dateTime={openedAt.toISOString()}>
              Today{" "}
              {openedAt.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
            <p className="agent-greeting">
              Hi{userName ? ` ${userName.split(" ")[0]}` : " there"}!
            </p>
            <p className="agent-introduction">
              {agent?.system_managed
                ? "Ask me about what you’re working on, or hand off a step. Use Team to work together, or Auto to let me carry a task through your tabs."
                : agent
                  ? `I’m ${agent.name}. Tell me what you’d like help with, and we’ll take it from there.`
                  : "Create an agent to start a conversation."}
            </p>
            {showSuggestions && agent && (
              <div className="agent-starters">
                <div className="agent-starters-heading">
                  <h3>What can I take off your plate?</h3>
                  <IconButton
                    size="xs"
                    label="Dismiss suggestions"
                    onClick={() => setShowSuggestions(false)}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
                <div className="agent-starter-options">
                  {suggestions.map(([label, prompt], index) => (
                    <Pressable
                      key={label}
                      className="flex items-center hover:bg-cream/[0.045] min-h-[38px] w-full gap-2 rounded-none px-2 py-2"
                      disabled={!agent.enabled || state.working}
                      onClick={() => {
                        setDraft(prompt);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span className="agent-option-letter" aria-hidden>
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span>{label}</span>
                    </Pressable>
                  ))}
                </div>
                <Input
                  className="mt-2.5 h-8"
                  aria-label="Custom answer"
                  placeholder="Type your own answer"
                  value={draft}
                  disabled={!agent.enabled || state.working}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
              </div>
            )}
            {!agent && (
              <Button variant="secondary" className="mt-4" onClick={onCreate}>
                Create an agent
              </Button>
            )}
          </div>
        )}
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
              disabled={!agent?.enabled || state.working || voice.requesting || voice.transcribing}
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
