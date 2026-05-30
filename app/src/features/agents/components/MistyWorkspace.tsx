import { useAuth } from "@/features/auth";
import { SystemErrorActivity } from "@/features/activity";
import { MistyRegionCapture, VoiceInputMenu, useAiVoiceRecorder } from "@/features/ai-surface";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { MistyModelPicker } from "@/features/global-search/MistyModelPicker";
import {
  captureToFile,
  deleteMistyImage,
  uploadMistyImage,
} from "@/features/global-search/mistyImageAttachments";
import { useGlobalSearchStore } from "@/features/global-search/useGlobalSearchStore";
import type { MistyImageAttachment } from "@/features/global-search/types";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore } from "@/features/workspace";
import { Button, cn } from "@/shared/ui";
import { Mic, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { AgentConversationView } from "./AgentConversationView";
import { resolveAgentSpaceId, resolveMentionedAgentSpaceId } from "../agentSpaceSelection";
import { MistyConversationSidebar } from "./MistyConversationSidebar";
import { MistySpacePicker } from "./MistySpacePicker";
import {
  agentBrowserResearchQuery,
  createAgentOwnedBrowserWorkspace,
} from "../agentOwnedBrowserWorkspace";

export function MistyWorkspace(props: {
  requestedConversationId?: string;
  requestedDraft?: string;
  onManageConnections: () => void;
}) {
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MistyImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const {
    conversations,
    activeConversationId,
    conversationsLoading,
    working,
    error,
    setAccount,
    loadConversations,
    newConversation,
    bindConversationSpace,
    selectConversation,
    deleteConversation,
    renameConversation,
    submitAnswer,
    approveAgentTask,
    cancelAgentTask,
    rejectAction,
  } = useGlobalSearchStore(
    useShallow((state) => ({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      conversationsLoading: state.conversationsLoading,
      working: state.working,
      error: state.error,
      setAccount: state.setAccount,
      loadConversations: state.loadConversations,
      newConversation: state.newConversation,
      bindConversationSpace: state.bindConversationSpace,
      selectConversation: state.selectConversation,
      deleteConversation: state.deleteConversation,
      renameConversation: state.renameConversation,
      submitAnswer: state.submitAnswer,
      approveAgentTask: state.approveAgentTask,
      cancelAgentTask: state.cancelAgentTask,
      rejectAction: state.rejectAction,
    })),
  );
  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId),
    [activeConversationId, conversations],
  );
  const spaces = useSpacesStore((state) => state.spaces);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const defaultSpaceId = useMemo(
    () => resolveAgentSpaceId(spaces, activeScopeKey),
    [activeScopeKey, spaces],
  );
  const displayedSpaceId = activeConversation?.spaceId || defaultSpaceId;
  const voice = useAiVoiceRecorder({
    onTranscript: (text) => setDraft((value) => `${value.trim()}${value.trim() ? " " : ""}${text}`),
    onError: setAttachmentError,
  });

  useEffect(() => {
    if (!user?.id) return;
    setAccount(user.id);
    void loadConversations();
  }, [loadConversations, setAccount, user?.id]);

  useEffect(() => {
    const requested = props.requestedConversationId;
    if (requested && conversations.some((item) => item.id === requested)) {
      selectConversation(requested);
    }
  }, [conversations, props.requestedConversationId, selectConversation]);

  useEffect(() => {
    const requested = props.requestedDraft?.trim();
    if (!requested) return;
    setDraft(requested);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("draft");
        return next;
      },
      { replace: true },
    );
  }, [props.requestedDraft, setSearchParams]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [activeConversation?.messages.length, activeConversationId, working]);

  const chooseConversation = (conversationId: string) => {
    selectConversation(conversationId);
    setSearchParams({ conversation: conversationId }, { replace: true });
  };

  const startNew = async (spaceId = defaultSpaceId) => {
    const conversationId = await newConversation(spaceId || undefined);
    setSearchParams({ conversation: conversationId }, { replace: true });
  };

  const removeConversation = async (conversationId: string) => {
    const wasActive = conversationId === activeConversationId;
    await deleteConversation(conversationId);
    if (wasActive) {
      const next = useGlobalSearchStore.getState().activeConversationId;
      setSearchParams(next ? { conversation: next } : {}, { replace: true });
    }
  };

  const runPrompt = (prompt: string, images: MistyImageAttachment[] = []) => {
    if (working) return;
    void (async () => {
      let conversation = useGlobalSearchStore
        .getState()
        .conversations.find(
          (item) => item.id === useGlobalSearchStore.getState().activeConversationId,
        );
      const mentionedSpaceId = resolveMentionedAgentSpaceId(spaces, prompt);
      const targetSpaceId = mentionedSpaceId || conversation?.spaceId || defaultSpaceId;

      if (
        !conversation ||
        (conversation.spaceId &&
          mentionedSpaceId !== "" &&
          conversation.spaceId !== mentionedSpaceId)
      ) {
        const conversationId = await newConversation(targetSpaceId || undefined);
        setSearchParams({ conversation: conversationId }, { replace: true });
        conversation = useGlobalSearchStore
          .getState()
          .conversations.find((item) => item.id === conversationId);
      } else if (!conversation.spaceId && targetSpaceId) {
        await bindConversationSpace(conversation.id, targetSpaceId);
      }

      const browserWorkspace = agentBrowserResearchQuery(prompt)
        ? await createAgentOwnedBrowserWorkspace(prompt)
        : null;
      if (browserWorkspace) {
        const state = useGlobalSearchStore.getState();
        state.setContext([...state.context, browserWorkspace.context]);
      }
      if (browserWorkspace) {
        await submitAnswer(prompt, images.length ? images : undefined, undefined, "workspace", [
          browserWorkspace.deviceContext,
        ]);
      } else {
        await submitAnswer(prompt, images.length ? images : undefined, undefined, "workspace");
      }
    })().catch((promptError: unknown) => {
      setAttachmentError(
        promptError instanceof Error ? promptError.message : "Misty could not start that work.",
      );
    });
  };

  const submit = () => {
    const prompt = draft.trim();
    if (
      (!prompt && !attachments.length) ||
      working ||
      attachments.some((item) => item.state !== "ready")
    )
      return;
    setDraft("");
    const sent = attachments;
    setAttachments([]);
    sent.forEach(
      (item) => item.previewUrl.startsWith("blob:") && URL.revokeObjectURL(item.previewUrl),
    );
    runPrompt(prompt, sent);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const addFiles = async (files: File[]) => {
    setAttachmentError("");
    let conversationId = useGlobalSearchStore.getState().activeConversationId;
    if (!conversationId) conversationId = await newConversation(defaultSpaceId || undefined);
    for (const file of files) {
      const draftId = `draft-${crypto.randomUUID()}`;
      const previewUrl = URL.createObjectURL(file);
      const placeholder: MistyImageAttachment = {
        id: draftId,
        name: file.name,
        mimeType: file.type as MistyImageAttachment["mimeType"],
        byteSize: file.size,
        width: 1,
        height: 1,
        previewUrl,
        state: "uploading",
        progress: 0,
      };
      setAttachments((items) => [...items, placeholder]);
      try {
        const uploaded = await uploadMistyImage(file, {
          scope: "conversation",
          conversationId,
          onProgress: (progress) =>
            setAttachments((items) =>
              items.map((item) => (item.id === draftId ? { ...item, progress } : item)),
            ),
        });
        URL.revokeObjectURL(previewUrl);
        setAttachments((items) => items.map((item) => (item.id === draftId ? uploaded : item)));
      } catch (uploadError) {
        setAttachments((items) =>
          items.map((item) =>
            item.id === draftId
              ? {
                  ...item,
                  state: "failed",
                  error: uploadError instanceof Error ? uploadError.message : "Upload failed",
                }
              : item,
          ),
        );
        setAttachmentError(
          uploadError instanceof Error ? uploadError.message : "Misty could not upload that image.",
        );
      }
    }
  };

  return (
    <main
      className="grid h-full min-h-0 grid-cols-[270px_minmax(0,1fr)] overflow-hidden max-[760px]:grid-cols-[220px_minmax(0,1fr)]"
      data-misty-agent-chat
    >
      <MistyConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        loading={conversationsLoading}
        onSelect={chooseConversation}
        onNew={() => void startNew()}
        onRename={(id, title) => void renameConversation(id, title)}
        onDelete={(id) => void removeConversation(id)}
        onManageConnections={props.onManageConnections}
      />

      <section
        className="flex min-h-0 min-w-0 flex-col bg-charcoal-bg"
        aria-label="Misty workspace"
      >
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-charcoal-border/80 px-6">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-[15px] font-semibold tracking-tight text-cream-bright">
              {activeConversation?.title ?? "Talk to Misty"}
            </h2>
            <p className="m-0 mt-0.5 truncate text-[11px] text-cream-muted">
              Ask questions and coordinate work across Misty.
            </p>
          </div>
          <MistySpacePicker
            spaces={spaces}
            activeSpaceId={displayedSpaceId}
            disabled={working || conversationsLoading}
            onSelect={(spaceId) => {
              if (spaceId === activeConversation?.spaceId) return;
              if (
                activeConversation &&
                !activeConversation.spaceId &&
                activeConversation.messages.length === 0
              ) {
                void bindConversationSpace(activeConversation.id, spaceId);
                return;
              }
              void startNew(spaceId);
            }}
          />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-charcoal-border",
              "bg-charcoal-card/60 px-2.5 py-1 text-[10px] text-cream-muted",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                working ? "animate-pulse bg-blue-400" : "bg-green-400",
              )}
            />
            {working ? "Working" : "Ready"}
          </span>
        </header>
        <div ref={scrollRef} className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="min-h-full">
            <AgentConversationView
              conversation={activeConversation}
              working={working}
              onConfirm={(id) => void approveAgentTask(id)}
              onReject={rejectAction}
              onCancel={(id) => void cancelAgentTask(id)}
              onRetry={runPrompt}
            />
          </div>
        </div>
        <div className="shrink-0 bg-gradient-to-t from-charcoal-bg via-charcoal-bg to-transparent px-5 pb-5 pt-3">
          <MistyComposer
            value={draft}
            onChange={setDraft}
            mode="ask"
            attachments={attachments}
            maxAttachments={10}
            onAddFiles={addFiles}
            onRemoveAttachment={async (attachment) => {
              setAttachments((items) => items.filter((item) => item.id !== attachment.id));
              await deleteMistyImage(attachment).catch(() => undefined);
            }}
            onSubmit={submit}
            onKeyDown={onComposerKeyDown}
            onCapture={() => setCapturing(true)}
            disabled={!user?.id}
            busy={working}
            onError={setAttachmentError}
            className="mx-auto max-w-[760px]"
            modelControl={
              <MistyModelPicker
                conversationId={activeConversationId}
                modelId={activeConversation?.modelId}
                reasoningEffort={activeConversation?.reasoningEffort}
                disabled={working}
                onChange={(settings) =>
                  useGlobalSearchStore.setState((state) => ({
                    conversations: state.conversations.map((item) =>
                      item.id === activeConversationId ? { ...item, ...settings } : item,
                    ),
                  }))
                }
              />
            }
            voiceControl={
              <div className="flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-7 text-cream-muted", voice.recording && "text-red-300")}
                  onClick={voice.recording ? voice.stop : () => void voice.start()}
                  disabled={voice.requesting || voice.transcribing}
                  aria-label={voice.recording ? "Stop voice recording" : "Start voice recording"}
                >
                  {voice.recording ? (
                    <Square className="size-3 fill-current" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                </Button>
                <VoiceInputMenu
                  compact
                  devices={voice.inputDevices}
                  selectedDeviceId={voice.selectedInputDeviceId}
                  disabled={voice.requesting || voice.recording || voice.transcribing}
                  onRefresh={() => void voice.refreshInputDevices()}
                  onSelect={voice.selectInputDevice}
                />
              </div>
            }
          />
          {error || attachmentError ? (
            <SystemErrorActivity
              accountId={user?.id}
              error={error || attachmentError}
              scope="misty:workspace"
              title="Misty needs attention"
            />
          ) : null}
          <div className="mx-auto mt-2 flex max-w-[760px] justify-center text-[10px] text-cream-muted">
            <span>Misty can make mistakes. Review important actions.</span>
          </div>
        </div>
      </section>
      {capturing ? (
        <MistyRegionCapture
          onCancel={() => setCapturing(false)}
          onCapture={(capture) => {
            setCapturing(false);
            void addFiles([captureToFile(capture)]);
          }}
        />
      ) : null}
    </main>
  );
}
