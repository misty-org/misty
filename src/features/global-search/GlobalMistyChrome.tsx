import { MistyAgentPicker } from "./MistyAgentPicker";
import { VoiceInputMenu, type useAiVoiceRecorder } from "@/features/ai-surface";
import { cn, IconButton } from "@/shared/ui";
import { Mic, Plus, Settings2, Square, X } from "lucide-react";
import type { KeyboardEvent, RefObject, ReactNode } from "react";
import { ConversationMenu } from "./GlobalMistyPanelContent";
import { MistyComposer } from "./MistyComposer";
import { MistyModelPicker } from "./MistyModelPicker";
import type { GlobalAiConversation, GlobalAiMode, MistyImageAttachment } from "./types";

type VoiceRecorder = ReturnType<typeof useAiVoiceRecorder>;

export function GlobalMistyComposerBar(props: {
  headerControls?: ReactNode;
  accountId: string;
  showSettings?: boolean;
  onToggleSettings?: () => void;
  query: string;
  onQuery: (value: string) => void;
  mode: GlobalAiMode;
  conversationActive: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  attachments: MistyImageAttachment[];
  onModeChange: (mode: GlobalAiMode) => void;
  onAddFiles: (files: File[]) => Promise<void>;
  onRemoveAttachment: (attachment: MistyImageAttachment) => Promise<void>;
  onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCapture?: () => void;
  busy: boolean;
  working: boolean;
  conversation?: GlobalAiConversation;
  reasoningEffort: string;
  activeConversationId: string;
  voice: VoiceRecorder;
  onError: (message: string) => void;
  onClose: () => void;
  onModelChange: (settings: { modelId: string; reasoningEffort: "high" | "xhigh" }) => void;
}) {
  return (
    <div className="relative">
      {props.headerControls && (
        <header className="flex items-center gap-2 px-4 pt-3 pb-1">
          <MistyAgentPicker accountId={props.accountId} />
          {props.conversationActive && (
            <span className="min-w-0 truncate text-xs text-cream-muted">
              {props.conversation?.title}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 text-cream-muted">
            {props.headerControls}
            <IconButton label="Close Misty" onClick={props.onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        </header>
      )}
      <MistyComposer
        modelId={props.conversation?.modelId}
        value={props.query}
        onChange={props.onQuery}
        mode={props.mode}
        onModeChange={undefined}
        textareaRef={props.textareaRef}
        attachments={props.attachments}
        maxAttachments={props.mode === "search" ? 1 : 10}
        onAddFiles={props.onAddFiles}
        onRemoveAttachment={props.onRemoveAttachment}
        onSubmit={props.onSubmit}
        onKeyDown={props.onKeyDown}
        onCapture={props.onCapture}
        busy={props.busy}
        compact={props.conversationActive}
        placeholder={
          props.conversationActive
            ? "Ask a follow-up…"
            : props.headerControls
              ? "What would you like to do?"
              : undefined
        }
        className="mx-3 my-2"
        onError={props.onError}
        modelControl={
          props.headerControls ? (
            <IconButton
              label="Thinking options"
              aria-expanded={props.showSettings}
              aria-controls="misty-settings"
              onClick={props.onToggleSettings}
            >
              <Settings2 className="size-4" />
            </IconButton>
          ) : props.mode !== "search" ? (
            <MistyModelPicker
              conversationId={props.activeConversationId}
              modelId={props.conversation?.modelId}
              reasoningEffort={props.reasoningEffort}
              disabled={props.working}
              onChange={props.onModelChange}
            />
          ) : undefined
        }
        voiceControl={
          props.mode !== "search" && <ComposerVoiceControls voice={props.voice} showInputMenu />
        }
        trailingControl={
          !props.headerControls && (
            <IconButton label="Close Misty" onClick={props.onClose}>
              <X className="size-4" />
            </IconButton>
          )
        }
      />
      {props.headerControls && props.showSettings && (
        <section
          id="misty-settings"
          aria-label="Misty options"
          className="max-h-[40dvh] overflow-y-auto border-t border-charcoal-border px-4 py-3 text-xs"
        >
          <MistyModelPicker
            inline
            conversationId={props.activeConversationId}
            modelId={props.conversation?.modelId}
            reasoningEffort={props.reasoningEffort}
            disabled={props.working}
            onChange={props.onModelChange}
          />
        </section>
      )}
    </div>
  );
}

function ComposerVoiceControls({
  voice,
  showInputMenu,
}: {
  voice: VoiceRecorder;
  showInputMenu?: boolean;
}) {
  return (
    <div className="flex items-center">
      <IconButton
        label={voice.recording ? "Stop voice recording" : "Talk to Misty"}
        className={cn(voice.recording && "text-red-300")}
        disabled={voice.requesting || voice.transcribing}
        onClick={voice.recording ? voice.stop : () => void voice.start()}
      >
        {voice.recording ? <Square className="size-3 fill-current" /> : <Mic className="size-4" />}
      </IconButton>
      {showInputMenu && (
        <VoiceInputMenu
          compact
          devices={voice.inputDevices}
          selectedDeviceId={voice.selectedInputDeviceId}
          disabled={voice.requesting || voice.recording || voice.transcribing}
          onRefresh={() => void voice.refreshInputDevices()}
          onSelect={voice.selectInputDevice}
        />
      )}
    </div>
  );
}

export function GlobalMistyConversationControls(props: {
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" aria-label="Misty conversations">
      <ConversationMenu
        compact
        conversations={props.conversations}
        activeId={props.activeConversationId}
        loading={props.loading}
        onSelect={props.onSelect}
        onNew={props.onNew}
        onDelete={props.onDelete}
        onRename={props.onRename}
      />
      <IconButton label="New conversation" onClick={props.onNew}>
        <Plus className="size-4" />
      </IconButton>
    </div>
  );
}
