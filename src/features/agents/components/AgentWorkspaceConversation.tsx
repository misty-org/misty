import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import type { AgentProfile } from "@misty/contracts";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { useGlobalMistyAttachments } from "@/features/global-search/useGlobalMistyAttachments";
import { aiSurfaceApi } from "@/features/ai-surface/api";
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
  spaceId,
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
  const state = useMistyStore();
  const [draft, setDraft] = useState("");

  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scoped = state.conversations.filter(
    (c) =>
      (c.agentId === agent?.id || (!c.agentId && agent?.system_managed)) &&
      (c.spaceId || "") === spaceId,
  );
  const conversation = scoped.find((c) => c.id === state.activeConversationId);

  const reportError = (error: string) => useMistyStore.setState({ error: error || null });
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
    onDraftStateChange?.({ dirty: hasDraft, busy: composingBusy });
    return () => onDraftStateChange?.({ dirty: false, busy: false });
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
    await useMistyStore
      .getState()
      .submitAnswer(prompt, attachments.attachments, undefined, "workspace", [], {
        conversationId: conversation?.id ?? "",
        context: spaceId
          ? [
              {
                kind: "space",
                id: spaceId,
                title: "Selected Space",
                spaceId,
                privacy: "shared",
                source: "current",
                attached: true,
              },
            ]
          : [],
      });
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
        ) : (
          <div className="agent-welcome">
            <time className="agent-conversation-date" dateTime={openedAt.toISOString()}>
              Today {openedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </time>
            <p className="agent-greeting">
              Hi{userName ? ` ${userName.split(" ")[0]}` : " there"}!
            </p>
            <p className="agent-introduction">
              {agent?.system_managed
                ? "I can help you find answers, write and plan, work with the apps you connect, and keep track of ongoing tasks. Tell me what you’d like to take off your plate, and we’ll work through it together."
                : agent
                  ? `I’m ${agent.name}. Tell me what you’d like help with, and we’ll take it from there.`
                  : "Create an agent to start a conversation."}
            </p>
            {showSuggestions && agent && (
              <div className="agent-starters">
                <div className="agent-starters-heading">
                  <h3>What can I take off your plate?</h3>
                  <button
                    className="agent-icon-button"
                    aria-label="Dismiss suggestions"
                    onClick={() => setShowSuggestions(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="agent-starter-options">
                  {suggestions.map(([label, prompt], index) => (
                    <button
                      key={label}
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
                    </button>
                  ))}
                </div>
                <input
                  className="agent-custom-answer"
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
              <button className="agent-create-action" onClick={onCreate}>
                Create an agent
              </button>
            )}
          </div>
        )}
      </div>
      <div className="agent-compose-area">
        {state.error && (
          <div role="alert" className="agent-compose-error">
            <p>{state.error}</p>
            <button
              className="agent-icon-button"
              aria-label="Dismiss error"
              onClick={() => reportError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {agent && !agent.enabled && (
          <p className="agent-compose-hint">
            This agent is disabled. Enable it in Settings to start a conversation.
          </p>
        )}
        <MistyComposer
          className="agent-workspace-composer"
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
            <button
              className="agent-voice-button"
              aria-label={voice.recording ? "Stop recording" : "Start voice input"}
              title={voice.recording ? "Stop recording" : "Voice input"}
              disabled={!agent?.enabled || state.working || voice.requesting || voice.transcribing}
              onClick={() => (voice.recording ? voice.stop() : void voice.start())}
            >
              {voice.requesting || voice.transcribing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : voice.recording ? (
                <Square size={16} />
              ) : (
                <Mic size={18} />
              )}
            </button>
          }
          trailingControl={
            state.working ? (
              <button
                className="agent-icon-button"
                aria-label="Stop response"
                onClick={() => {
                  if (state.invocationId)
                    void aiSurfaceApi
                      .cancelInvocation(state.invocationId)
                      .catch((e) => reportError(String(e)));
                }}
              >
                <Square size={16} />
              </button>
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
