import type { MailAccount, MailDraftAttachmentInput, MailDraftInput } from "@/api/mail";
import { reportSystemError } from "@/features/activity";
import { Button, Textarea, cn } from "@/shared/ui";
import { Forward, Maximize2, Reply, Send, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MistyFilePicker, readFilesFromPaths } from "@/features/picker";
import { parseAddressList, prepareReplyDraft, type InboxThread, type ReplyMode } from "../model";
import { AttachmentChips, readFileAsDraftAttachment } from "./AttachmentChips";
import { ComposerFormattingBar } from "./ComposerFormattingBar";

export function InlineQuickReply(props: {
  thread: InboxThread;
  accounts: MailAccount[];
  replyMode: ReplyMode;
  onReplyModeChange: (mode: ReplyMode) => void;
  onExpandToModal: (draft: {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    text: string;
    mode: ReplyMode;
  }) => void;
  onSend: (draft: MailDraftInput) => Promise<void>;
}) {
  const { thread, accounts, replyMode, onReplyModeChange, onExpandToModal, onSend } = props;
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<MailDraftAttachmentInput[]>([]);
  const [sending, setSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const account = useMemo(
    () => accounts.find((a) => a.connection_id === thread.connectionId) ?? accounts[0],
    [accounts, thread.connectionId],
  );

  const prepared = useMemo(
    () => prepareReplyDraft(thread, account?.email, replyMode),
    [thread, account?.email, replyMode],
  );

  useEffect(() => {
    if (replyMode === "forward") {
      setText(prepared.text);
    } else {
      setText("");
    }
    setAttachments([]);
  }, [replyMode, prepared]);

  const handleSend = async () => {
    if (!text.trim() && !attachments.length) return;
    setSending(true);
    try {
      const payload: MailDraftInput = {
        connection_id: thread.connectionId,
        thread_id: thread.provider_id,
        to: parseAddressList(prepared.to || account?.email || ""),
        cc: prepared.cc ? parseAddressList(prepared.cc) : undefined,
        bcc: prepared.bcc ? parseAddressList(prepared.bcc) : undefined,
        subject: prepared.subject,
        text,
        attachments: attachments.length ? attachments : undefined,
      };
      await onSend(payload);
      setText("");
      setAttachments([]);
    } catch (cause) {
      reportSystemError({
        error: cause,
        scope: `inbox:reply:${thread.connectionId}`,
        title: "Email reply could not be sent",
        target: { kind: "route", href: "/inbox" },
      });
    } finally {
      setSending(false);
    }
  };

  const handlePaths = async (paths: string[]) => {
    if (!paths.length) return;
    const files = await readFilesFromPaths(paths);
    const added: MailDraftAttachmentInput[] = [];
    for (const file of files) {
      try {
        const att = await readFileAsDraftAttachment(file);
        added.push(att);
      } catch {
        // Skip invalid file
      }
    }
    setAttachments((prev) => [...prev, ...added]);
  };

  return (
    <div className="mt-8 rounded-xl border border-charcoal-border bg-charcoal-card/70 p-4 shadow-sm">
      {/* Mode Selector & Expand Button */}
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-charcoal-border/50 pb-2.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant={replyMode === "reply" ? "default" : "ghost"}
            className={cn("gap-1.5 text-xs", replyMode !== "reply" && "text-cream-faint")}
            onClick={() => onReplyModeChange("reply")}
          >
            <Reply className="size-3.5" />
            Reply
          </Button>
          <Button
            type="button"
            size="xs"
            variant={replyMode === "replyAll" ? "default" : "ghost"}
            className={cn("gap-1.5 text-xs", replyMode !== "replyAll" && "text-cream-faint")}
            onClick={() => onReplyModeChange("replyAll")}
          >
            <Users className="size-3.5" />
            Reply all
          </Button>
          <Button
            type="button"
            size="xs"
            variant={replyMode === "forward" ? "default" : "ghost"}
            className={cn("gap-1.5 text-xs", replyMode !== "forward" && "text-cream-faint")}
            onClick={() => onReplyModeChange("forward")}
          >
            <Forward className="size-3.5" />
            Forward
          </Button>
        </div>

        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="text-cream-faint hover:text-cream"
          aria-label="Expand to full window"
          title="Expand to full window"
          onClick={() =>
            onExpandToModal({
              to: prepared.to,
              cc: prepared.cc,
              bcc: prepared.bcc,
              subject: prepared.subject,
              text,
              mode: replyMode,
            })
          }
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </div>

      {/* Recipient info line */}
      <div className="mb-2 text-xs text-cream-faint">
        <span className="text-cream-muted">To: </span>
        <span className="font-medium text-cream">{prepared.to || "(no recipient specified)"}</span>
        {prepared.cc ? (
          <>
            <span className="ml-2 text-cream-muted">Cc: </span>
            <span className="text-cream">{prepared.cc}</span>
          </>
        ) : null}
      </div>

      {/* Composer box */}
      <div className="overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-bg">
        <ComposerFormattingBar
          textareaRef={textareaRef}
          text={text}
          onTextChange={setText}
          onAttachClick={() => setPickerOpen(true)}
        />
        <Textarea
          ref={textareaRef}
          className="min-h-28 resize-y border-0 bg-transparent text-xs leading-relaxed focus-visible:ring-0"
          placeholder={
            replyMode === "forward"
              ? "Add optional forwarding notes…"
              : "Type your reply here… (⌘+Enter to send)"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
      </div>

      <AttachmentChips
        attachments={attachments}
        onRemove={(idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-cream-faint">Press ⌘+Enter to send</span>
        <Button
          type="button"
          size="sm"
          disabled={sending || (!text.trim() && !attachments.length)}
          onClick={() => void handleSend()}
          className="gap-1.5"
        >
          <Send className="size-3.5" />
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      {pickerOpen ? (
        <MistyFilePicker
          mode="file"
          multiple
          title="Attach files"
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false);
            void handlePaths([path]);
          }}
          onSelectMany={(paths) => {
            setPickerOpen(false);
            void handlePaths(paths);
          }}
        />
      ) : null}
    </div>
  );
}
