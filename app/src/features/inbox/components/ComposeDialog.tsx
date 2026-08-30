import type { MailAccount, MailDraft, MailDraftAttachmentInput, MailDraftInput } from "@/api/mail";
import { reportSystemError } from "@/features/activity";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  cn,
} from "@/shared/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { MistyFilePicker, readFilesFromPaths } from "@/features/picker";
import { parseAddressList, prepareReplyDraft, type InboxThread, type ReplyMode } from "../model";
import { AttachmentChips, readFileAsDraftAttachment } from "./AttachmentChips";
import { ComposerFormattingBar } from "./ComposerFormattingBar";

export function ComposeDialog(props: {
  open: boolean;
  accounts: MailAccount[];
  replyTo: InboxThread | null;
  replyMode?: ReplyMode;
  initialDraft?: { to?: string; cc?: string; bcc?: string; subject?: string; text?: string };
  onOpenChange: (open: boolean) => void;
  onSave: (draft: MailDraftInput, draftId?: string) => Promise<MailDraft>;
  onSend: (draftId: string, connectionId: string) => Promise<void>;
}) {
  const [connectionId, setConnectionId] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<MailDraftAttachmentInput[]>([]);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedAccount = useMemo(
    () => props.accounts.find((acc) => acc.connection_id === connectionId) ?? props.accounts[0],
    [connectionId, props.accounts],
  );

  useEffect(() => {
    if (!props.open) return;
    const initialConnId = props.replyTo?.connectionId || props.accounts[0]?.connection_id || "";
    setConnectionId(initialConnId);

    const userEmail = props.accounts.find((a) => a.connection_id === initialConnId)?.email;

    if (props.replyTo) {
      const mode = props.replyMode ?? "reply";
      const prepared = prepareReplyDraft(props.replyTo, userEmail, mode);
      setTo(props.initialDraft?.to ?? prepared.to);
      setCc(props.initialDraft?.cc ?? prepared.cc);
      setBcc(props.initialDraft?.bcc ?? prepared.bcc);
      setShowCc(Boolean(props.initialDraft?.cc ?? prepared.cc));
      setShowBcc(Boolean(props.initialDraft?.bcc ?? prepared.bcc));
      setSubject(props.initialDraft?.subject ?? prepared.subject);
      setText(props.initialDraft?.text ?? prepared.text);
    } else {
      setTo(props.initialDraft?.to ?? "");
      setCc(props.initialDraft?.cc ?? "");
      setBcc(props.initialDraft?.bcc ?? "");
      setShowCc(Boolean(props.initialDraft?.cc));
      setShowBcc(Boolean(props.initialDraft?.bcc));
      setSubject(props.initialDraft?.subject ?? "");
      setText(props.initialDraft?.text ?? "");
    }

    setAttachments([]);
    setDraft(null);
    setValidationError("");
  }, [props.accounts, props.initialDraft, props.open, props.replyMode, props.replyTo]);

  const payload = (): MailDraftInput => ({
    connection_id: connectionId,
    thread_id: props.replyTo?.provider_id,
    to: parseAddressList(to),
    cc: showCc && cc.trim() ? parseAddressList(cc) : undefined,
    bcc: showBcc && bcc.trim() ? parseAddressList(bcc) : undefined,
    subject: subject.trim(),
    text,
    attachments: attachments.length ? attachments : undefined,
  });

  const save = async () => {
    if (!connectionId || !parseAddressList(to).length || !subject.trim()) {
      setValidationError("Choose an account and add a recipient and subject.");
      return null;
    }
    setBusy(true);
    setValidationError("");
    try {
      const saved = await props.onSave(payload(), draft?.provider_id);
      setDraft(saved);
      return saved;
    } catch (cause) {
      reportSystemError({
        error: cause,
        scope: `inbox:compose:${connectionId}:draft`,
        title: "Email draft could not be saved",
        target: { kind: "route", href: "/inbox" },
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const reviewSend = async () => {
    if (await save()) setConfirmOpen(true);
  };

  const send = async () => {
    if (!draft) return;
    setBusy(true);
    setValidationError("");
    try {
      await props.onSend(draft.provider_id, connectionId);
      setConfirmOpen(false);
      props.onOpenChange(false);
    } catch (cause) {
      reportSystemError({
        error: cause,
        scope: `inbox:compose:${connectionId}:send`,
        title: "Email could not be sent",
        target: { kind: "route", href: "/inbox" },
      });
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const added: MailDraftAttachmentInput[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const att = await readFileAsDraftAttachment(file);
        added.push(att);
      } catch {
        // Skip failed attachment
      }
    }
    setAttachments((prev) => [...prev, ...added]);
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
        // Skip failed attachment
      }
    }
    setAttachments((prev) => [...prev, ...added]);
  };

  const insertSignature = () => {
    const signature = selectedAccount?.display_name
      ? `\n\n--\n${selectedAccount.display_name}`
      : selectedAccount?.email
        ? `\n\n--\n${selectedAccount.email}`
        : "";
    if (signature && !text.includes(signature.trim())) {
      setText((t) => t + signature);
    }
  };

  const dialogTitle = props.replyTo
    ? props.replyMode === "forward"
      ? "Forward email"
      : props.replyMode === "replyAll"
        ? "Reply all"
        : "Reply"
    : "New email";

  return (
    <>
      <Dialog open={props.open} onOpenChange={(open) => !busy && props.onOpenChange(open)}>
        <DialogContent className="max-w-[700px] gap-0 p-0">
          <DialogHeader className="border-b border-charcoal-border px-5 py-4">
            <DialogTitle className="text-sm">{dialogTitle}</DialogTitle>
          </DialogHeader>

          <div
            className={cn(
              "grid gap-3 px-5 py-4 transition-colors",
              isDragging && "bg-sage-fg/5 outline-dashed outline-2 outline-sage-fg",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <label className="grid gap-1.5 text-xs text-cream-muted">
              From
              <select
                className="h-9 rounded-md border border-charcoal-border bg-charcoal-card px-2 text-xs text-cream outline-none"
                value={connectionId}
                disabled={Boolean(props.replyTo)}
                onChange={(event) => setConnectionId(event.target.value)}
              >
                {props.accounts.map((account) => (
                  <option key={account.connection_id} value={account.connection_id}>
                    {account.email || account.display_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-1.5 text-xs text-cream-muted">
              <div className="flex items-center justify-between">
                <span>To</span>
                <div className="flex items-center gap-2">
                  {!showCc ? (
                    <button
                      type="button"
                      className="text-[11px] text-cream-faint hover:text-cream"
                      onClick={() => setShowCc(true)}
                    >
                      Cc
                    </button>
                  ) : null}
                  {!showBcc ? (
                    <button
                      type="button"
                      className="text-[11px] text-cream-faint hover:text-cream"
                      onClick={() => setShowBcc(true)}
                    >
                      Bcc
                    </button>
                  ) : null}
                </div>
              </div>
              <Input
                value={to}
                placeholder="name@example.com"
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            {showCc ? (
              <Field label="Cc" value={cc} onChange={setCc} placeholder="cc@example.com" />
            ) : null}

            {showBcc ? (
              <Field label="Bcc" value={bcc} onChange={setBcc} placeholder="bcc@example.com" />
            ) : null}

            <Field label="Subject" value={subject} onChange={setSubject} />

            <div className="grid gap-0 overflow-hidden rounded-md border border-charcoal-border bg-charcoal-card">
              <ComposerFormattingBar
                textareaRef={textareaRef}
                text={text}
                onTextChange={setText}
                onAttachClick={() => setPickerOpen(true)}
              />
              <Textarea
                ref={textareaRef}
                className="min-h-52 resize-y border-0 bg-transparent text-sm leading-relaxed focus-visible:ring-0"
                placeholder="Write your email here… (⌘+Enter to send)"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void reviewSend();
                  }
                }}
              />
            </div>

            <AttachmentChips
              attachments={attachments}
              onRemove={(idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
            />

            {validationError ? (
              <p className="m-0 text-xs text-sage-fg" role="alert">
                {validationError}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between border-t border-charcoal-border px-5 py-3">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-[11px] text-cream-faint hover:text-cream"
              onClick={insertSignature}
            >
              Insert signature
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => props.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save draft"}
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void reviewSend()}>
                Review send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this email?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send “{subject.trim() || "(no subject)"}” to {to}
              {showCc && cc ? ` (Cc: ${cc})` : ""}. Misty never sends a draft without this
              confirmation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              {busy ? "Sending…" : "Send email"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </>
  );
}

function Field(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-cream-muted">
      {props.label}
      <Input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
