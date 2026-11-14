import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { Globe, Mic, Square } from "lucide-react";
import type { useAiVoiceRecorder } from "../../runs/markdown/useAiVoiceRecorder";
import { MistyComposer } from "../composer/MistyComposer";
import type { useGlobalMistyAttachments } from "../composer/useGlobalMistyAttachments";
import { useMistyStore } from "../state/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, MenuItem, type ActionBarItem } from "@/shared/ui";
import { chooseEngineMode, type usePermissionMode } from "../../plans/permissionMode";
import { resolveEngineMode, useEngineModes } from "../../engines/engineModes";
import type { useCollaborationComposer } from "../../plans/useCollaborationComposer";
import { currentSpaceKey, mistyEngine } from "../../engines/enginesApi";
import {
  BrowserChip,
  captureRegionFile,
  engineModeItem,
  modelEffortItem,
  vimItem,
  useEngineModels,
} from "../composer/controls/ComposerControls";
import { useComposerSuggestions } from "../composer/controls/ComposerSuggestions";
import { handleVimKey, useComposerVim } from "../composer/controls/composerVim";
import { useEngineFolder } from "../composer/controls/FolderSegment";
import { useAgentFolder, useAgentFolders } from "../../shared-folders/agentFolder";
import {
  useBrowserAttached,
  useBrowserAttachment,
  useChatChoices,
  useComposerChoices,
} from "../composer/controls/composerChoices";
import { ContextMeter } from "../composer/controls/ContextMeter";
import { useChatContextUsage, watchContextUsage } from "../composer/controls/contextUsage";
import { usePromptHistoryNav } from "../composer/usePromptHistoryNav";

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
 * and screen capture, effort, the engine's mode and model, giving way in that order), with
 * the context ring, voice and send (Stop while a reply runs and nothing is typed) at its end.
 * Where the chat works (Space, folder, branch) is in the context panel. `@` mentions a file in
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
  empty = false,
  status,
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
  /** The chat has no messages yet: the composer is roomier. */
  empty?: boolean;
  /** Rows about the chat's state at the top of the box, such as queued messages. */
  status?: ReactNode;
}) {
  const engine = agent?.engine && agent.engine !== mistyEngine ? agent.engine : "";
  // The engine's own modes; the chat's saved choice read as one of them.
  const modes = useEngineModes(engine || mistyEngine);
  const mode = resolveEngineMode(modes, permission, collaboration.mode === "plan");
  const planning = mode?.kind === "plans";
  const teaching = collaboration.mode === "teach";
  const space = currentSpaceKey();
  // Every chat with an agent works in its one folder. One it doesn't have yet takes the Space's
  // folder on its first run, so that is what `@` mentions read until then.
  const spaceFolder = useEngineFolder(space, Boolean(engine));
  const ownFolder = useAgentFolder(agent);
  const folder = !engine || ownFolder === undefined ? "" : (ownFolder ?? spaceFolder);
  const agentId = agent?.id;
  // A first run may have given the agent its folder: read it again once a reply ends.
  useEffect(() => {
    if (engine && agentId && !working && ownFolder === null)
      useAgentFolders.getState().refresh(agentId);
  }, [engine, agentId, working, ownFolder]);
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
        roomy={empty}
        status={status}
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
          // Vim keys, when on, take what they need before history and sending.
          if (handleVimKey(e, textareaRef, setDraft)) return;
          // Up in an empty box brings back what was sent before.
          if (history.handleKeyDown(e)) return;
          if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
            // Shift+Tab steps through the engine's own modes, as in the engines' own tools.
            e.preventDefault();
            if (modes.length > 1 && mode) {
              const next = modes[(modes.indexOf(mode) + 1) % modes.length];
              void chooseEngineMode(conversationId, next, teaching);
            }
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            // The next message starts in insert mode, as a new Vim buffer would.
            useComposerVim.getState().reset();
            if (!attachments.attachments.some((a) => a.state !== "ready")) send();
          }
        }}
        // Who the chat is with, and nothing else: @ and / open their menus when typed.
        placeholder={`${planning ? "Plan with" : "Message"} ${agent?.name || "Misty"}`}
        disabled={disabled}
        items={items}
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
    </>
  );
}
