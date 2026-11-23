import { useSpeechSupport } from "@/features/voice";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { Download, Globe, History, LogIn, Mic, RefreshCw, Square } from "lucide-react";
import type { useAiVoiceRecorder } from "../../runs/markdown/use_ai_voice_recorder";
import { MistyComposer } from "../composer/MistyComposer";
import type { useGlobalMistyAttachments } from "../composer/use_global_misty_attachments";
import { useMistyStore } from "../state/use_misty_store";
import type { AgentProfile } from "@/shared/schemas";
import {
  ComposerStatusRow,
  IconButton,
  MenuItem,
  MessageComposerAction,
  type ActionBarItem,
} from "@misty/ui";
import { ENGINE_NAMES, type EngineId } from "@/features/engine-config/channels";
import { blocksAgent, useEngineReadiness } from "../../engines/engine_readiness";
import { EngineNextStep } from "../../engines/EngineNextStep";
import { chooseEngineMode, type usePermissionMode } from "../../plans/permission_mode";
import { resolveEngineMode, useEngineModes } from "../../engines/engine_modes";
import type { useCollaborationComposer } from "../../plans/use_collaboration_composer";
import { mistyEngine } from "../../engines/engines_api";
import {
  BrowserChip,
  captureRegionFile,
  engineModeItem,
  modelEffortItem,
  vimItem,
  useEngineModels,
} from "../composer/controls/ComposerControls";
import { useComposerSuggestions } from "../composer/controls/ComposerSuggestions";
import { handleVimKey, useComposerVim } from "../composer/controls/composer_vim";
import { useChatFolder } from "../../shared-folders/chat_folder";
import {
  useBrowserAttached,
  useBrowserAttachment,
  useChatChoices,
  useComposerChoices,
} from "../composer/controls/composer_choices";
import { ContextMeter } from "../composer/controls/ContextMeter";
import { useChatContextUsage, watchContextUsage } from "../composer/controls/context_usage";
import { usePromptHistoryNav } from "../composer/use_prompt_history_nav";

const engineNames: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  qwen: "Qwen Code",
  kimi: "Kimi CLI",
  grok: "Grok CLI",
  minimax: "MiniMax Code",
  qoder: "Qoder CLI",
  "qoder-cn": "Qoder CLI (China)",
  omp: "Oh My Pi",
  codebuddy: "CodeBuddy",
  agy: "Antigravity",
  pi: "Pi",
};

export function AgentConversationComposer({
  agent,
  accountId,
  conversationId,
  draft,
  setDraft,
  textareaRef,
  attachments,
  voice,
  collaboration,
  permission,
  working,
  send,
  reportError,
  empty = false,
  status,
  onOpenHistory,
  onSync,
}: {
  agent?: AgentProfile;
  accountId: string;
  conversationId?: string;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  attachments: ReturnType<typeof useGlobalMistyAttachments>;
  voice: ReturnType<typeof useAiVoiceRecorder>;
  collaboration: ReturnType<typeof useCollaborationComposer>;
  permission: ReturnType<typeof usePermissionMode>;
  working: boolean;
  send: () => void;
  reportError: (message: string) => void;
  empty?: boolean;
  status?: ReactNode;
  onOpenHistory?: () => void;
  onSync?: () => void;
}) {
  const engine = agent?.engine && agent.engine !== mistyEngine ? agent.engine : "";
  const modes = useEngineModes(engine || mistyEngine);
  const mode = resolveEngineMode(modes, permission, collaboration.mode === "plan");
  const planning = mode?.kind === "plans";
  const teaching = collaboration.mode === "teach";
  const { folder } = useChatFolder(conversationId);
  useEffect(() => {
    watchContextUsage();
    if (conversationId) void useComposerChoices.getState().load(accountId, conversationId);
  }, [accountId, conversationId]);
  const runIds = useMistyStore((state) =>
    (state.conversations.find((chat) => chat.id === conversationId)?.messages ?? [])
      .flatMap((message) => (message.invocationId ? [message.invocationId] : []))
      .join(" "),
  );
  const usage = useChatContextUsage(runIds ? runIds.split(" ") : []);
  const suggestions = useComposerSuggestions({
    text: draft,
    setText: setDraft,
    textareaRef,
    engine: engine || mistyEngine,
    folder,
    onAction: () => attachBrowser(true),
  });
  const history = usePromptHistoryNav({
    getText: () => textareaRef.current?.value ?? draft,
    setText: setDraft,
  });
  const readiness = useEngineReadiness(engine);
  const held = Boolean(engine) && blocksAgent(readiness.state);
  const engineName = ENGINE_NAMES[engine as EngineId] ?? engine;
  const disabled = !agent?.enabled || !accountId || held;
  const browserAttached = useBrowserAttached(conversationId);
  const attachBrowser = (attached: boolean) =>
    useBrowserAttachment.getState().set(conversationId, attached);
  const capture = async () => {
    try {
      const file = await captureRegionFile();
      if (file) await attachments.addFiles([file]);
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
    }
  };
  const choices = useChatChoices(conversationId);
  const vimOn = useComposerVim((s) => s.on);
  const vimMode = useComposerVim((s) => s.state.mode);
  const models = useEngineModels(engine);

  const items = [
    engineModeItem({ conversationId, modes, current: mode, teaching, disabled }),
    modelEffortItem({
      accountId,
      conversationId,
      engine,
      engineName: engineNames[engine],
      models,
      choices,
      agentModel: agent?.engine_model,
      agentEffort: agent?.reasoning_effort,
      disabled,
    }),
    vimItem({ on: vimOn, mode: vimMode }),
  ].filter((item): item is ActionBarItem => Boolean(item));

  const stop =
    working && !draft.trim() && !attachments.attachments.length ? (
      <MessageComposerAction
        label="Stop response"
        onClick={() => {
          void useMistyStore
            .getState()
            .cancelResponse?.()
            .catch((e) => reportError(String(e)));
        }}
      >
        <Square fill="currentColor" />
      </MessageComposerAction>
    ) : undefined;
  const listening = voice.recording;
  const speech = useSpeechSupport();
  const voiceBusy = voice.requesting || voice.transcribing;
  return (
    <>
      <MistyComposer
        className="agent-toolbar-composer"
        roomy={empty}
        status={
          held ? (
            <>
              <ComposerStatusRow
                icon={readiness.state === "sign-in" ? LogIn : Download}
                actions={
                  <EngineNextStep
                    engine={engine as EngineId}
                    view={readiness.view}
                    state={readiness.state}
                  />
                }
              >
                {readiness.state === "sign-in"
                  ? `${engineName} isn't signed in`
                  : `${engineName} isn't installed`}
              </ComposerStatusRow>
              {status}
            </>
          ) : (
            status
          )
        }
        value={draft}
        onChange={setDraft}
        textareaRef={textareaRef}
        attachments={attachments.attachments}
        maxAttachments={4}
        onAddFiles={attachments.addFiles}
        onRemoveAttachment={attachments.remove}
        onSubmit={send}
        onError={reportError}
        onCapture={() => void capture()}
        popup={suggestions.popup}
        attachedChips={
          engine && browserAttached ? <BrowserChip onRemove={() => attachBrowser(false)} /> : null
        }
        addMenuItems={
          engine ? (
            <>
              <MenuItem
                icon={Globe}
                label="Misty's browser"
                disabled={browserAttached}
                reason={browserAttached ? "Already attached to this message" : undefined}
                onSelect={() => attachBrowser(true)}
              />
              {onSync && conversationId ? (
                <MenuItem
                  icon={RefreshCw}
                  label={`Sync from ${engineNames[engine] ?? "the engine"}`}
                  disabled={working}
                  onSelect={onSync}
                />
              ) : null}
              {onOpenHistory ? (
                <MenuItem
                  icon={History}
                  label="Continue an earlier chat"
                  disabled={working}
                  onSelect={onOpenHistory}
                />
              ) : null}
            </>
          ) : null
        }
        onKeyDown={(e) => {
          if (suggestions.onKeyDown(e)) {
            e.preventDefault();
            return;
          }
          if (handleVimKey(e, textareaRef, setDraft)) return;
          if (history.handleKeyDown(e)) return;
          if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (modes.length > 1 && mode) {
              const next = modes[(modes.indexOf(mode) + 1) % modes.length];
              void chooseEngineMode(conversationId, next, teaching);
            }
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            useComposerVim.getState().reset();
            if (!attachments.attachments.some((a) => a.state !== "ready")) send();
          }
        }}
        placeholder={`${planning ? "Plan with" : "Message"} ${agent?.name || "Misty"}`}
        disabled={disabled}
        items={items}
        end={
          <>
            <ContextMeter usage={usage} engine={engine || mistyEngine} />
            {speech?.recognition ? (
              <IconButton
                label={
                  listening ? "Stop recording" : voiceBusy ? "Transcribing" : "Start voice input"
                }
                aria-pressed={listening || undefined}
                disabled={disabled || working || voiceBusy}
                onClick={() => (listening ? voice.stop() : void voice.start())}
              >
                {listening ? <Square /> : <Mic />}
              </IconButton>
            ) : null}
          </>
        }
        sendControl={stop}
      />
    </>
  );
}
