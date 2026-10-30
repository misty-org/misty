import type { Dispatch, RefObject, SetStateAction } from "react";
import { Mic, Square } from "lucide-react";
import type { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";
import { MistyComposer } from "@/features/misty/MistyComposer";
import type { useGlobalMistyAttachments } from "@/features/misty/useGlobalMistyAttachments";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
import { IconButton, Spinner } from "@/shared/ui";
import { AgentCodingToolMenu } from "../collaboration/AgentCodingToolMenu";
import { AgentModeMenu } from "../collaboration/AgentModeToggle";
import { AgentProjectMenu } from "../collaboration/AgentProjectMenu";
import type { usePermissionMode } from "../collaboration/permissionMode";
import type { useCollaborationComposer } from "../collaboration/useCollaborationComposer";
import { ComposerStrip } from "./ComposerStrip";

/** The conversation's message box, its voice and stop controls, and the strip beneath it. */
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
  return (
    <>
      <MistyComposer
        layout="inline"
        value={draft}
        onChange={setDraft}
        textareaRef={textareaRef}
        attachments={attachments.attachments}
        maxAttachments={4}
        onAddFiles={attachments.addFiles}
        onRemoveAttachment={attachments.remove}
        onSubmit={send}
        onError={reportError}
        onKeyDown={(e) => {
          if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
            // Shift+Tab turns Plan on or off, as in other agent tools.
            e.preventDefault();
            collaboration.toggleMode();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!attachments.attachments.some((a) => a.state !== "ready")) send();
          }
        }}
        placeholder={
          planning ? `Plan with ${agent?.name || "Misty"}…` : `Message ${agent?.name || "Misty"}…`
        }
        disabled={!agent?.enabled || !accountId}
        busy={working && !draft.trim()}
        voiceControl={
          <>
            <IconButton
              label={voice.recording ? "Stop recording" : "Start voice input"}
              disabled={
                !agent?.enabled || !accountId || working || voice.requesting || voice.transcribing
              }
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
          </>
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
      <ComposerStrip
        project={<AgentProjectMenu conversationId={conversationId} />}
        mode={
          <AgentModeMenu
            conversationId={conversationId}
            mode={collaboration.mode}
            permission={permission}
          />
        }
        code={<AgentCodingToolMenu conversationId={conversationId} disabled={working} />}
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
