import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { Globe, Mic, Square } from "lucide-react";
import type { useAiVoiceRecorder } from "../../runs/markdown/useAiVoiceRecorder";
import { MistyComposer } from "../composer/MistyComposer";
import type { useGlobalMistyAttachments } from "../composer/useGlobalMistyAttachments";
import { useMistyStore } from "../state/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, MenuItem, Spinner } from "@/shared/ui";
import { AgentFolderMenu } from "../../plans/AgentFolderMenu";
import type { usePermissionMode } from "../../plans/permissionMode";
import type { useCollaborationComposer } from "../../plans/useCollaborationComposer";
import { currentSpaceKey, folderOf, mistyEngine, useSpaceFolders } from "../../engines/enginesApi";
import {
  BrowserChip,
  CaptureButton,
  captureRegionFile,
  EffortMenu,
  GoalButton,
  ModelMenu,
  ModeMenu,
  PermissionMenu,
} from "../composer/controls/ComposerControls";
import { useComposerSuggestions } from "../composer/controls/ComposerSuggestions";
import { BranchMenu } from "../composer/controls/BranchMenu";
import { ChatSpaceMenu } from "../composer/controls/ChatSpaceMenu";
import {
  useBrowserAttached,
  useBrowserAttachment,
  useComposerChoices,
} from "../composer/controls/composerChoices";
import { ContextMeter } from "../composer/controls/ContextMeter";
import { useChatContextUsage, watchContextUsage } from "../composer/controls/contextUsage";
import { engineOptions } from "../composer/controls/engineOptions";
import { usePromptHistoryNav } from "../composer/usePromptHistoryNav";
import "../composer/controls/composerControls.css";

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

/**
 * The conversation's message box. The text fills the box and one bar beneath it, inside the box,
 * holds every control: attach, capture, permissions, goal, the chat's Space, folder and Git branch
 * on the left; effort, mode,
 * model, context, voice and send (Stop while a reply runs) on the right. `@` mentions a file in
 * the linked folder, `/` runs a command and `$` uses a skill.
 */
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
}) {
  const { planning } = collaboration;
  const engine = agent?.engine && agent.engine !== mistyEngine ? agent.engine : "";
  const space = currentSpaceKey();
  const folder = useSpaceFolders((state) => folderOf(state, space));
  useEffect(() => {
    if (engine)
      void useSpaceFolders
        .getState()
        .load(space)
        .catch(() => undefined);
  }, [engine, space]);
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
    folder: engine ? folder : "",
    onAction: () => attachBrowser(true),
  });
  const history = usePromptHistoryNav({
    getText: () => textareaRef.current?.value ?? draft,
    setText: setDraft,
  });
  const disabled = !agent?.enabled || !accountId;
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
  const allowed = engineOptions(engine).modes;
  return (
    <>
      <MistyComposer
        layout="toolbar"
        className="agent-toolbar-composer"
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
        attachMenuItems={
          engine ? (
            <MenuItem
              icon={<Globe className="size-4" />}
              label="Misty's browser"
              disabled={browserAttached}
              onSelect={() => attachBrowser(true)}
            />
          ) : null
        }
        onKeyDown={(e) => {
          if (suggestions.onKeyDown(e)) {
            e.preventDefault();
            return;
          }
          // Up in an empty box brings back what was sent before.
          if (history.handleKeyDown(e)) return;
          if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
            // Shift+Tab turns Plan on or off, as in other agent tools.
            e.preventDefault();
            if (planning || allowed.includes("plan")) collaboration.toggleMode();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!attachments.attachments.some((a) => a.state !== "ready")) send();
          }
        }}
        placeholder={
          planning
            ? `Plan with ${agent?.name || "Misty"}. @ to mention, / for commands`
            : engine
              ? "Plan, build, or ask. @ to mention, $ for skills, / for commands"
              : `Message ${agent?.name || "Misty"}…`
        }
        disabled={disabled}
        busy={working && !draft.trim()}
        toolbarStart={
          <>
            <CaptureButton disabled={disabled} onCapture={() => void capture()} />
            <PermissionMenu
              conversationId={conversationId}
              permission={permission}
              engine={engine}
              disabled={disabled}
            />
            <GoalButton conversationId={conversationId} disabled={disabled} />
            <ChatSpaceMenu conversationId={conversationId} disabled={disabled || working} />
            <AgentFolderMenu conversationId={conversationId} />
            {engine && folder ? <BranchMenu folder={folder} disabled={disabled} /> : null}
          </>
        }
        toolbarEnd={
          <>
            <ContextMeter usage={usage} engine={engine || mistyEngine} />
            <EffortMenu
              accountId={accountId}
              conversationId={conversationId}
              engine={engine}
              agentEffort={agent?.reasoning_effort}
              disabled={disabled}
            />
            <ModelMenu
              accountId={accountId}
              conversationId={conversationId}
              engine={engine}
              engineName={engineNames[engine]}
              agentModel={agent?.engine_model}
              disabled={disabled}
            />
            <ModeMenu
              conversationId={conversationId}
              mode={collaboration.mode}
              engine={engine}
              disabled={disabled}
            />
          </>
        }
        voiceControl={
          <IconButton
            label={voice.recording ? "Stop recording" : "Start voice input"}
            disabled={disabled || working || voice.requesting || voice.transcribing}
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
          working ? (
            <IconButton
              variant="outline"
              className="text-cream-bright"
              label="Stop response"
              onClick={() => {
                void useMistyStore
                  .getState()
                  .cancelResponse?.()
                  .catch((e) => reportError(String(e)));
              }}
            >
              <Square className="size-3.5" fill="currentColor" />
            </IconButton>
          ) : undefined
        }
      />
      {/* Working status belongs to the transcript, under the message that started it. */}
      {(voice.recording || voice.transcribing) && (
        <p className="agent-compose-status" role="status">
          {voice.recording ? "Listening…" : "Transcribing…"}
        </p>
      )}
    </>
  );
}
