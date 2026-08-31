import { VoiceInputMenu, type useAiVoiceRecorder } from "@/features/ai-surface";
import mistyCompanion from "@/shared/assets/misty-cloud-expression-cycle.webp";
import { Button, cn } from "@/shared/ui";
import { GripHorizontal, Mic, Square, X } from "lucide-react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { ConversationMenu } from "./GlobalMistyPanelContent";
import { MistyComposer } from "./MistyComposer";
import { MistyModelPicker } from "./MistyModelPicker";
import { SearchAskToggle } from "./GlobalMistySupport";
import type { GlobalAiConversation, GlobalAiMode, MistyImageAttachment } from "./types";

type VoiceRecorder = ReturnType<typeof useAiVoiceRecorder>;

export function GlobalMistyComposerBar(props: {
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
  activeConversationId: string;
  voice: VoiceRecorder;
  onError: (message: string) => void;
  onClose: () => void;
  onRequestDrag?: (event: PointerEvent) => void;
  onSwitchToPet?: () => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onModelChange: (settings: {
    modelId: string;
    reasoningEffort: "" | "low" | "medium" | "high";
  }) => void;
}) {
  return (
    <div
      onPointerDown={!props.conversationActive ? props.onPointerDown : undefined}
      className={cn(
        "relative",
        !props.conversationActive && props.onRequestDrag && "cursor-grab active:cursor-grabbing",
      )}
    >
      {!props.conversationActive ? (
        <MistyPanelDragHandle inset onRequestDrag={props.onRequestDrag} />
      ) : null}
      <MistyComposer
        value={props.query}
        onChange={props.onQuery}
        mode={props.mode}
        onModeChange={props.conversationActive ? undefined : props.onModeChange}
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
        className={cn(
          props.conversationActive ? "m-3" : "rounded-none border-x-0 border-t-0 shadow-none",
        )}
        onError={props.onError}
        modelControl={
          <MistyModelPicker
            conversationId={props.activeConversationId}
            modelId={props.conversation?.modelId}
            reasoningEffort={props.conversation?.reasoningEffort}
            disabled={props.working}
            onChange={props.onModelChange}
          />
        }
        voiceControl={<ComposerVoiceControls voice={props.voice} />}
        trailingControl={
          props.conversationActive ? undefined : (
            <div className="flex items-center gap-0.5">
              {props.onSwitchToPet ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 rounded-lg text-cream-muted"
                  aria-label="Switch to Misty pet"
                  title="Switch to Misty pet"
                  onClick={props.onSwitchToPet}
                >
                  <img
                    src={mistyCompanion}
                    alt=""
                    className="size-5 object-contain"
                    draggable={false}
                  />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-cream-muted"
                aria-label="Close Misty"
                onClick={props.onClose}
              >
                <X className="size-4" />
              </Button>
            </div>
          )
        }
      />
    </div>
  );
}

function ComposerVoiceControls({ voice }: { voice: VoiceRecorder }) {
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-7 text-cream-muted", voice.recording && "text-red-300")}
        disabled={voice.requesting || voice.transcribing}
        onClick={voice.recording ? voice.stop : () => void voice.start()}
        aria-label={voice.recording ? "Stop voice recording" : "Transcribe voice into prompt"}
      >
        {voice.recording ? <Square className="size-3 fill-current" /> : <Mic className="size-4" />}
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
  );
}

export function GlobalMistyVoiceIsland(props: {
  voice: VoiceRecorder;
  conversations: GlobalAiConversation[];
  activeConversationId: string;
  loading: boolean;
  mode: GlobalAiMode;
  onModeChange: (mode: GlobalAiMode) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
  onRequestDrag?: (event: PointerEvent) => void;
  onSwitchToPet?: () => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "group/misty-island pointer-events-auto relative flex h-11 items-center gap-1.5 rounded-full border border-white/10",
        "bg-[#17171a]/[0.98] p-1.5 text-cream shadow-[0_10px_30px_rgba(0,0,0,0.5)]",
        props.onRequestDrag && "cursor-grab active:cursor-grabbing",
      )}
      data-misty-voice-island
      onPointerDown={props.onPointerDown}
    >
      <MistyPanelDragHandle onRequestDrag={props.onRequestDrag} />
      <button
        type="button"
        className={cn(
          "relative grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.05]",
          "outline-none ring-offset-1 ring-offset-[#17171a] focus-visible:ring-2 focus-visible:ring-blue-400",
          props.voice.recording && "ring-2 ring-red-400/70",
        )}
        aria-label={
          props.onSwitchToPet
            ? "Switch to Misty pet"
            : props.voice.recording
              ? "Stop voice recording"
              : "Start voice recording"
        }
        title={props.onSwitchToPet ? "Switch to Misty pet" : undefined}
        disabled={props.onSwitchToPet ? false : props.voice.requesting || props.voice.transcribing}
        onClick={
          props.onSwitchToPet ??
          (props.voice.recording ? props.voice.stop : () => void props.voice.start())
        }
      >
        <img src={mistyCompanion} alt="" className="size-7 object-contain" draggable={false} />
        {props.voice.recording ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-400" />
        ) : null}
      </button>
      <VoiceInputMenu
        compact
        devices={props.voice.inputDevices}
        selectedDeviceId={props.voice.selectedInputDeviceId}
        disabled={props.voice.requesting || props.voice.recording || props.voice.transcribing}
        onRefresh={() => void props.voice.refreshInputDevices()}
        onSelect={props.voice.selectInputDevice}
      />
      <ConversationMenu
        conversations={props.conversations}
        activeId={props.activeConversationId}
        loading={props.loading}
        onSelect={props.onSelect}
        onNew={props.onNew}
        onDelete={props.onDelete}
        onRename={props.onRename}
      />
      <SearchAskToggle mode={props.mode} compact onChange={props.onModeChange} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-full text-cream-muted hover:bg-white/[0.06]"
        aria-label="Close Misty"
        onClick={props.onClose}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function MistyPanelDragHandle(props: {
  onRequestDrag?: (event: PointerEvent) => void;
  inset?: boolean;
}) {
  if (!props.onRequestDrag) return null;
  return (
    <button
      type="button"
      aria-label="Move Misty window"
      title="Drag to move Misty"
      data-misty-panel-drag-handle="true"
      className={cn(
        "absolute left-1/2 z-20 flex h-4 w-11 -translate-x-1/2 items-center justify-center rounded-full",
        props.inset ? "top-1" : "top-0 -translate-y-1/2",
        "pointer-events-auto touch-none select-none cursor-grab border border-white/10 bg-[#25252a]/95 text-white/65 shadow-[0_3px_10px_rgba(0,0,0,0.32)] active:cursor-grabbing",
        "opacity-100 transition-[color,background-color] duration-150 hover:bg-[#303036] hover:text-white/85",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        props.onRequestDrag?.(event);
      }}
    >
      <GripHorizontal className="size-3.5" aria-hidden />
    </button>
  );
}
