import { VoiceInputMenu, type useAiVoiceRecorder } from "@/features/ai-surface";
import { cn, IconButton } from "@/shared/ui";
import { Mic, Square, X } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { MistyComposer } from "./MistyComposer";
import { MistyModelPicker } from "./MistyModelPicker";
import type { GlobalAiConversation, GlobalAiMode, MistyImageAttachment } from "./types";

type VoiceRecorder = ReturnType<typeof useAiVoiceRecorder>;

export function GlobalMistyComposerBar(props: {
  accountId: string;
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
        placeholder={props.conversationActive ? "Ask a follow-up…" : undefined}
        className="mx-3 my-2"
        onError={props.onError}
        modelControl={
          props.mode !== "search" ? (
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
          <IconButton label="Close Misty" onClick={props.onClose}>
            <X className="size-4" />
          </IconButton>
        }
      />
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
