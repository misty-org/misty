import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Globe, Mic, Square } from "lucide-react";
import type { useAiVoiceRecorder } from "../../runs/markdown/useAiVoiceRecorder";
import { MistyComposer } from "../composer/MistyComposer";
import type { useGlobalMistyAttachments } from "../composer/useGlobalMistyAttachments";
import { useMistyStore } from "../state/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, MenuItem, type ActionBarItem, type PathLineSegment } from "@/shared/ui";
import { useDeviceFolderSegment } from "../../plans/AgentFolderMenu";
import { AgentGoalDialog } from "../../plans/AgentGoalDialog";
import type { usePermissionMode } from "../../plans/permissionMode";
import { useCollaborationStore } from "../../plans/store";
import type { useCollaborationComposer } from "../../plans/useCollaborationComposer";
import { currentSpaceKey, mistyEngine } from "../../engines/enginesApi";
import {
  BrowserChip,
  captureRegionFile,
  effortItem,
  goalItem,
  modeItem,
  modelItem,
  permissionItem,
  useEngineModels,
} from "../composer/controls/ComposerControls";
import { useComposerSuggestions } from "../composer/controls/ComposerSuggestions";
import { useBranchSegment } from "../composer/controls/BranchMenu";
import { useSpaceSegment } from "../composer/controls/ChatSpaceMenu";
import { useEngineFolder, useEngineFolderSegment } from "../composer/controls/FolderSegment";
import {
  useBrowserAttached,
  useBrowserAttachment,
  useChatChoices,
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
 * The conversation's message box: the text, then one bar that never wraps (the + menu with attach
 * and screen capture, permissions, goal, effort, mode and model, giving way in that order), with
 * the context ring, voice and send (Stop while a reply runs and nothing is typed) at its end.
 * Where the chat works, Space › folder › branch, is a line under the box. `@` mentions a file in
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
  ensureConversation,
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
  /** The open conversation's id, made first when there is none yet. */
  ensureConversation: () => Promise<string>;
  reportError: (message: string) => void;
}) {
  const { planning } = collaboration;
  const engine = agent?.engine && agent.engine !== mistyEngine ? agent.engine : "";
  const space = currentSpaceKey();
  const folder = useEngineFolder(space, Boolean(engine));
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
  const choices = useChatChoices(conversationId);
  const models = useEngineModels(engine);
  const goal = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId]?.goal : undefined,
  );
  // The goal belongs to a chat; pressing Goal in a new one makes the chat first.
  const [goalFor, setGoalFor] = useState<string>();
  const openGoal = () => {
    if (conversationId) return setGoalFor(conversationId);
    // Making the chat empties the box; what was typed stays for the person to send.
    const typed = draft;
    void ensureConversation()
      .then((id) => {
        if (typed) setDraft(typed);
        setGoalFor(id);
      })
      .catch((error: unknown) =>
        reportError(error instanceof Error ? error.message : String(error)),
      );
  };

  const items = [
    permissionItem({ conversationId, permission, engine, disabled }),
    goalItem({ goal: goal ?? undefined, disabled, onOpen: openGoal }),
    effortItem({
      accountId,
      conversationId,
      engine,
      choices,
      agentEffort: agent?.reasoning_effort,
      disabled,
    }),
    modeItem({ conversationId, mode: collaboration.mode, engine, disabled }),
    modelItem({
      accountId,
      conversationId,
      engine,
      engineName: engineNames[engine],
      models,
      choices,
      agentModel: agent?.engine_model,
      disabled,
    }),
  ].filter((item): item is ActionBarItem => Boolean(item));

  const spaceSegment = useSpaceSegment(conversationId, working);
  const engineFolderSegment = useEngineFolderSegment(space, folder);
  const deviceFolderSegment = useDeviceFolderSegment(conversationId);
  const branchSegment = useBranchSegment(engine ? folder : "");
  const path = [
    spaceSegment,
    engine ? engineFolderSegment : deviceFolderSegment,
    branchSegment,
  ].filter((segment): segment is PathLineSegment => Boolean(segment));

  // One button: Send while there is something to send, Stop while a reply runs and nothing is typed.
  const stop =
    working && !draft.trim() && !attachments.attachments.length ? (
      <IconButton
        variant="secondary"
        label="Stop response"
        onClick={() => {
          void useMistyStore
            .getState()
            .cancelResponse?.()
            .catch((e) => reportError(String(e)));
        }}
      >
        <Square fill="currentColor" />
      </IconButton>
    ) : undefined;
  const listening = voice.recording;
  const voiceBusy = voice.requesting || voice.transcribing;
  return (
    <>
      <MistyComposer
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
        addMenuItems={
          engine ? (
            <MenuItem
              icon={Globe}
              label="Misty's browser"
              disabled={browserAttached}
              reason={browserAttached ? "Already attached to this message" : undefined}
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
        // One line in the narrowest chat, beside the context panel.
        placeholder={
          planning
            ? `Plan with ${agent?.name || "Misty"}. @ mention, / commands`
            : engine
              ? "Ask, plan or build. @ mention, / commands"
              : `Message ${agent?.name || "Misty"}`
        }
        disabled={disabled}
        items={items}
        path={path}
        end={
          <>
            <ContextMeter usage={usage} engine={engine || mistyEngine} />
            <IconButton
              label={
                listening ? "Stop recording" : voiceBusy ? "Transcribing" : "Start voice input"
              }
              aria-pressed={listening || undefined}
              loading={voiceBusy}
              disabled={disabled || working}
              onClick={() => (listening ? voice.stop() : void voice.start())}
            >
              {listening ? <Square /> : <Mic />}
            </IconButton>
          </>
        }
        sendControl={stop}
      />
      <AgentGoalDialog
        conversationId={goalFor}
        open={Boolean(goalFor)}
        onOpenChange={(open) => !open && setGoalFor(undefined)}
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
