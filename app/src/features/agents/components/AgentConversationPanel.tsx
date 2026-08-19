import { agentsApi } from "@/api/agents/api";
import { spacesApi } from "@/api/spaces/api";
import type { Space, SpaceConversation, SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { browserAgentCapabilities } from "@/features/browser/browserAgentAccess";
import { browserScopeId } from "@/features/browser/browserRuntime";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useAuth } from "@/features/auth";
import { useSetupStore } from "@/features/installer";
import { mergeSpaceMessages, messageReplyPreviewText } from "@/features/spaces/chat";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@/shared/ui";
import { Activity, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AgentAvatar } from "../AgentAvatar";
import {
  cachedAgentConversation,
  loadAgentConversation,
  mergeCachedAgentConversationMessages,
} from "../agentConversationCache";
import type { PersonalAgent } from "../model/interfaces/personal";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { useAgentActivity } from "../useAgentActivity";
import { useAgentVoiceRecorder } from "../useAgentVoiceRecorder";
import { AgentActivityDrawer, ConversationMessage, InlineApproval } from "./AgentConversationParts";
import { AgentConversationComposer } from "./AgentConversationComposer";
import { agentBrowserLabel, latestAgentBrowserTab } from "./agentConversationBrowser";

type AgentActivityController = ReturnType<typeof useAgentActivity>;
const starterRequests = [
  "Create a task called Prepare the beta demo due tomorrow",
  "Create a note with a launch checklist",
  "Schedule a 30-minute demo on my calendar tomorrow",
  "Create a roadmap for the public beta",
];

export function AgentConversationPanel({
  agent,
  spaceId,
  spaces,
  onSpaceChange,
  onEdit,
  controller,
}: {
  agent: PersonalAgent;
  spaceId: string;
  spaces: Space[];
  onSpaceChange: (spaceId: string) => void;
  onEdit: () => void;
  controller: AgentActivityController;
}) {
  const initial = cachedAgentConversation(spaceId, agent.id);
  const [conversation, setConversation] = useState<SpaceConversation | null>(
    initial?.conversation ?? null,
  );
  const [messages, setMessages] = useState<SpaceMessage[]>(initial?.messages ?? []);
  const [loading, setLoading] = useState(!initial);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [attachBrowser, setAttachBrowser] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [inputModality, setInputModality] = useState<"text" | "voice">("text");
  const [audioByMessage, setAudioByMessage] = useState<Record<string, string>>({});
  const [playingMessageId, setPlayingMessageId] = useState("");
  const { user: authUser } = useAuth();
  const setupUser = useSetupStore((state) => state.status?.current_user ?? null);
  const currentUser = authUser ?? setupUser;
  const draft = useSpaceChatDraft(spaceId, conversation?.id ?? "");
  const endRef = useRef<HTMLDivElement>(null);
  const sendInFlightRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<string[]>([]);
  const spokenRunIds = useRef(new Set<string>());
  const resetDraft = draft.reset;
  const voice = useAgentVoiceRecorder({
    onTranscript: (transcript) => {
      draft.setText(transcript);
      setInputModality("voice");
    },
    onError: setError,
  });

  const browserTab = useMemo(latestAgentBrowserTab, [spaceId, agent.id]);
  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === spaceId),
    [spaceId, spaces],
  );
  const supportsWorkspaceActions = selectedSpace?.kind !== "misty";
  const relevantRuns = useMemo(
    () =>
      (controller.activity?.runs ?? []).filter(
        (run) =>
          run.space_id === spaceId &&
          (!run.source_message_id ||
            messages.some((message) => message.id === run.source_message_id)),
      ),
    [controller.activity?.runs, messages, spaceId],
  );
  const runBySourceMessage = useMemo(() => {
    const runs = new Map<string | undefined, (typeof relevantRuns)[number]>();
    for (const run of relevantRuns) {
      if (!runs.has(run.source_message_id)) runs.set(run.source_message_id, run);
    }
    return runs;
  }, [relevantRuns]);
  const working = relevantRuns.some((run) =>
    ["queued", "running", "awaiting_approval", "awaiting_device"].includes(run.state),
  );

  const refreshMessages = useCallback(
    async (force = false) => {
      if (!spaceId || !agent.id) return;
      try {
        const snapshot = await loadAgentConversation(spaceId, agent.id, { force });
        setConversation(snapshot.conversation);
        setMessages(snapshot.messages);
        setError("");
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "This conversation could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    },
    [agent.id, spaceId],
  );

  useEffect(() => {
    const cached = cachedAgentConversation(spaceId, agent.id);
    setConversation(cached?.conversation ?? null);
    setMessages(cached?.messages ?? []);
    setLoading(!cached);
    resetDraft();
    setInputModality("text");
    void refreshMessages(false);
  }, [agent.id, spaceId, refreshMessages, resetDraft]);

  useEffect(() => {
    if (!working) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") void refreshMessages(true);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [refreshMessages, working]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshMessages(working);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshMessages, working]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, working]);

  const speakMessage = useCallback(
    async (message: SpaceMessage, autoplay = false) => {
      const existing = audioByMessage[message.id];
      let url = existing;
      if (!url) {
        const blob = await agentsApi.speech(agent.id, messageReplyPreviewText(message));
        url = URL.createObjectURL(blob);
        audioUrlsRef.current.push(url);
        setAudioByMessage((current) => ({ ...current, [message.id]: url }));
      }
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingMessageId("");
      audio.onerror = () => setPlayingMessageId("");
      setPlayingMessageId(message.id);
      try {
        await audio.play();
      } catch {
        setPlayingMessageId("");
        if (!autoplay) setError("Audio playback was blocked. Try Replay again.");
      }
    },
    [agent.id, audioByMessage],
  );

  useEffect(() => {
    for (const run of relevantRuns) {
      if (
        run.input_modality !== "voice" ||
        !run.response_message_id ||
        spokenRunIds.current.has(run.run_id)
      )
        continue;
      const response = messages.find((message) => message.id === run.response_message_id);
      if (!response) continue;
      spokenRunIds.current.add(run.run_id);
      void speakMessage(response, true);
    }
  }, [messages, relevantRuns, speakMessage]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      for (const url of audioUrlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!conversation || draft.isEmpty || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    const clientNonce = crypto.randomUUID();
    const content = [{ type: "text" as const, text: draft.text.trim() }];
    const snapshot = {
      selectedFileIds: [...draft.selectedFileIds],
      selectedLibraryIds: [...draft.selectedLibraryIds],
      pendingAttachments: [...draft.pendingAttachments],
      inputModality,
      attachBrowser,
    };
    const optimisticMessage: SpaceMessage = {
      seq: Date.now(),
      id: `optimistic_${clientNonce}`,
      client_nonce: clientNonce,
      local_delivery_state: "sending",
      space_id: spaceId,
      conversation_id: conversation.id,
      sender_user_id: currentUser?.id ?? "",
      sender_name: currentUser?.name || "You",
      sender_kind: "person",
      content,
      file_node_ids: snapshot.selectedFileIds,
      library_item_ids: snapshot.selectedLibraryIds,
      attachments: snapshot.pendingAttachments,
      reactions: [],
      created_at: new Date().toISOString(),
    };

    setMessages((current) => mergeSpaceMessages(current, [optimisticMessage]));
    mergeCachedAgentConversationMessages(spaceId, agent.id, [optimisticMessage]);
    draft.reset();
    setInputModality("text");
    setAttachBrowser(false);
    setSending(true);
    setError("");
    try {
      const contextReferences = [];
      if (snapshot.attachBrowser && browserTab) {
        const snapshot = await agentsDeviceSnapshot();
        if (!snapshot.device || snapshot.device.status === "revoked") {
          throw new Error("This device is unavailable for browser work.");
        }
        const device = await ensureServerAgentDevice(snapshot.device);
        contextReferences.push({
          device_id: device.id,
          kind: "browser_tab" as const,
          opaque_ref: browserScopeId(browserTab),
          display_name: browserTab.title || "Browser tab",
          capabilities: [...browserAgentCapabilities],
        });
      }
      const response = await spacesApi.sendConversationMessage(
        spaceId,
        conversation.id,
        content,
        snapshot.selectedFileIds,
        snapshot.pendingAttachments.map((attachment) => attachment.id),
        snapshot.selectedLibraryIds,
        "",
        clientNonce,
        snapshot.inputModality,
        {
          agentId: agent.id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          contextReferences,
        },
      );
      response.message.client_nonce ||= clientNonce;
      response.message.triggered_runs = response.triggered_runs.map((run) => ({
        ...run,
        state: run.state as NonNullable<SpaceMessage["triggered_runs"]>[number]["state"],
      }));
      setMessages((current) => mergeSpaceMessages(current, [response.message]));
      mergeCachedAgentConversationMessages(spaceId, agent.id, [response.message]);
      void controller.refresh(true);
    } catch (reason) {
      const failed = { ...optimisticMessage, local_delivery_state: "failed" as const };
      setMessages((current) => mergeSpaceMessages(current, [failed]));
      mergeCachedAgentConversationMessages(spaceId, agent.id, [failed]);
      setError(reason instanceof Error ? reason.message : "That message could not be sent.");
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-charcoal-bg"
      aria-label={`Chat with ${agent.name}`}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-charcoal-border px-4">
        <AgentAvatar
          agentId={agent.id}
          avatar={agent.avatar}
          legacyIcon={agent.icon}
          name={agent.name}
        />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-sm font-semibold text-cream-bright">{agent.name}</h1>
          <p className="m-0 text-[11px] text-cream-muted">{working ? "Working…" : "Ready"}</p>
        </div>
        <Select value={spaceId} onValueChange={onSpaceChange}>
          <SelectTrigger className="h-8 w-auto min-w-28 max-w-48 rounded-full border-charcoal-border bg-charcoal-card px-3 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => setActivityOpen(true)}
          aria-label="Open activity"
        >
          <Activity className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" aria-label="Agent menu">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Preferences</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-5 px-5 py-6">
          {!loading && messages.length === 0 ? (
            <div className="my-auto grid place-items-center gap-2 py-16 text-center">
              <AgentAvatar
                agentId={agent.id}
                avatar={agent.avatar}
                legacyIcon={agent.icon}
                name={agent.name}
                className="size-12"
                iconClassName="size-6"
              />
              <h2 className="m-0 mt-2 text-base font-medium text-cream-bright">
                Talk to {agent.name}
              </h2>
              <p className="m-0 max-w-sm text-sm text-cream-muted">
                {supportsWorkspaceActions ? (
                  <>
                    Ask a question or give one clear command. {agent.name} can work with Tasks,
                    Notes, Calendar, Roadmaps, Library items, and people in this Space.
                  </>
                ) : (
                  <>
                    Ask questions here, or choose one of your Spaces above when you want{" "}
                    {agent.name}
                    to create or update workspace content.
                  </>
                )}
              </p>
              {supportsWorkspaceActions ? (
                <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">
                  {starterRequests.map((request) => (
                    <button
                      key={request}
                      type="button"
                      className={cn(
                        "rounded-full border border-charcoal-border bg-charcoal-card px-3 py-1.5",
                        "text-xs text-cream-muted transition-colors",
                        "hover:border-cream-muted/50 hover:text-cream",
                      )}
                      onClick={() => draft.setText(request)}
                    >
                      {request}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {messages.map((message) => {
            const run =
              runBySourceMessage.get(message.id) ??
              relevantRuns.find((item) => item.response_message_id === message.id);
            return (
              <ConversationMessage
                key={message.id}
                message={message}
                agent={agent}
                run={run}
                playing={playingMessageId === message.id}
                hasAudio={Boolean(audioByMessage[message.id]) || run?.input_modality === "voice"}
                onAudio={() => {
                  if (playingMessageId === message.id) {
                    audioRef.current?.pause();
                    setPlayingMessageId("");
                  } else {
                    void speakMessage(message);
                  }
                }}
                onRetry={run ? () => void controller.act(run.run_id, "retry") : undefined}
                retrying={Boolean(run && controller.actingRunId === run.run_id)}
                onDetails={() => {
                  if (run) void controller.loadDetail(run.run_id);
                  setActivityOpen(true);
                }}
              />
            );
          })}
          <InlineApproval controller={controller} />
          {working ? (
            <div className="flex items-center gap-2 text-xs text-cream-muted" aria-live="polite">
              <AgentAvatar
                agentId={agent.id}
                avatar={agent.avatar}
                legacyIcon={agent.icon}
                name={agent.name}
                className="size-6"
                iconClassName="size-3"
              />
              <span className="flex gap-1">
                <i className="size-1.5 animate-pulse rounded-full bg-cream-muted" />
                <i className="size-1.5 animate-pulse rounded-full bg-cream-muted [animation-delay:150ms]" />
                <i className="size-1.5 animate-pulse rounded-full bg-cream-muted [animation-delay:300ms]" />
              </span>
              <span>
                {controller.activity?.queue_count
                  ? `${controller.activity.queue_count} queued`
                  : "Working"}
              </span>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <AgentConversationComposer
        agentName={agent.name}
        spaceId={spaceId}
        draft={draft}
        voice={voice}
        inputModality={inputModality}
        sending={sending}
        error={error || controller.error}
        browserLabel={browserTab ? agentBrowserLabel(browserTab) : ""}
        attachBrowser={attachBrowser}
        onAttachBrowser={() => setAttachBrowser(true)}
        onDetachBrowser={() => setAttachBrowser(false)}
        onSend={send}
      />
      <AgentActivityDrawer
        open={activityOpen}
        onOpenChange={setActivityOpen}
        controller={controller}
        runs={relevantRuns}
      />
    </section>
  );
}
