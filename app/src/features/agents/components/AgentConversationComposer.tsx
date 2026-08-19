import { SpaceChatPicker } from "@/features/chat-composer/SpaceChatPicker";
import type { SpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Textarea,
  cn,
} from "@/shared/ui";
import { FilePlus2, Library, Mic, Paperclip, Plus, Send, Square } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { useAgentVoiceRecorder } from "../useAgentVoiceRecorder";
import { ContextChip } from "./AgentConversationParts";

type PickerSource = "files" | "library";

export function AgentConversationComposer({
  agentName,
  spaceId,
  draft,
  voice,
  inputModality,
  sending,
  error,
  browserLabel,
  attachBrowser,
  onAttachBrowser,
  onDetachBrowser,
  onSend,
}: {
  agentName: string;
  spaceId: string;
  draft: SpaceChatDraft;
  voice: ReturnType<typeof useAgentVoiceRecorder>;
  inputModality: "text" | "voice";
  sending: boolean;
  error: string;
  browserLabel: string;
  attachBrowser: boolean;
  onAttachBrowser: () => void;
  onDetachBrowser: () => void;
  onSend: (event?: FormEvent) => Promise<void>;
}) {
  const [pickerSource, setPickerSource] = useState<PickerSource | null>(null);

  return (
    <>
      <form
        className="shrink-0 border-t border-charcoal-border px-4 py-3"
        onSubmit={(event) => void onSend(event)}
      >
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-border bg-charcoal-card p-2 shadow-sm focus-within:border-cream-muted/40">
          {draft.pendingAttachments.length || draft.selectedLibraryIds.length || attachBrowser ? (
            <div className="flex flex-wrap gap-1.5 px-1 pb-2">
              {draft.pendingAttachments.map((attachment) => (
                <ContextChip key={attachment.id} label={attachment.display_name} />
              ))}
              {draft.selectedLibraryIds.map((id) => (
                <ContextChip key={id} label="Library item" />
              ))}
              {attachBrowser ? (
                <ContextChip label={browserLabel} onRemove={onDetachBrowser} />
              ) : null}
            </div>
          ) : null}
          <Textarea
            value={draft.text}
            rows={1}
            placeholder={
              voice.recording
                ? "Listening…"
                : voice.transcribing
                  ? "Transcribing…"
                  : `Message ${agentName}`
            }
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
            onChange={(event) => draft.setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSend();
              }
            }}
          />
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label="Add context"
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onSelect={() => setPickerSource("files")}>
                  <FilePlus2 className="size-4" /> Files
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPickerSource("library")}>
                  <Library className="size-4" /> Library items
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!browserLabel} onSelect={onAttachBrowser}>
                  <Paperclip className="size-4" /> Current browser tab
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {inputModality === "voice" ? (
              <span className="ml-1 text-[10px] text-cream-muted">
                Voice transcript—review before sending
              </span>
            ) : null}
            <span className="flex-1" />
            <Button
              type="button"
              size="icon"
              variant={voice.recording ? "outline" : "ghost"}
              className={cn("size-8", voice.recording && "text-red-300")}
              onClick={voice.recording ? voice.stop : () => void voice.start()}
              aria-label={voice.recording ? "Stop recording" : "Record voice"}
            >
              {voice.recording ? (
                <Square className="size-3.5 fill-current" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>
            <Button
              type="submit"
              size="icon"
              className="size-8 rounded-full"
              disabled={draft.isEmpty || sending || voice.recording || voice.transcribing}
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
        {error ? (
          <p className="mx-auto mb-0 mt-2 max-w-3xl px-2 text-xs text-red-300">{error}</p>
        ) : null}
      </form>

      {pickerSource ? (
        <SpaceChatPicker
          spaceId={spaceId}
          source={pickerSource}
          selectedLibraryIds={draft.selectedLibraryIds}
          pendingAttachmentCount={draft.pendingAttachments.length}
          canBrowseLibrary
          canUploadAttachments
          onClose={() => setPickerSource(null)}
          onChooseFiles={(paths) => void draft.uploadAttachments(paths)}
          onChooseLibraryItems={draft.setSelectedLibraryIds}
        />
      ) : null}
    </>
  );
}
