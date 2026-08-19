import type { MailAccount, MailDraft, MailDraftInput } from "@/api/mail";
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
} from "@/shared/ui";
import { useEffect, useState } from "react";
import { parseAddressList, type InboxThread } from "../model";

export function ComposeDialog(props: {
  open: boolean;
  accounts: MailAccount[];
  replyTo: InboxThread | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: MailDraftInput, draftId?: string) => Promise<MailDraft>;
  onSend: (draftId: string, connectionId: string) => Promise<void>;
}) {
  const [connectionId, setConnectionId] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    const replyMessages = props.replyTo?.messages ?? [];
    const replyMessage = replyMessages[replyMessages.length - 1];
    setConnectionId(props.replyTo?.connectionId || props.accounts[0]?.connection_id || "");
    setTo(replyMessage?.from.email ?? "");
    setSubject(
      props.replyTo
        ? props.replyTo.subject.toLowerCase().startsWith("re:")
          ? props.replyTo.subject
          : `Re: ${props.replyTo.subject}`
        : "",
    );
    setText("");
    setDraft(null);
    setError("");
  }, [props.accounts, props.open, props.replyTo]);

  const payload = (): MailDraftInput => ({
    connection_id: connectionId,
    thread_id: props.replyTo?.provider_id,
    to: parseAddressList(to),
    subject: subject.trim(),
    text,
    attachments: [],
  });

  const save = async () => {
    if (!connectionId || !parseAddressList(to).length || !subject.trim()) {
      setError("Choose an account and add a recipient and subject.");
      return null;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await props.onSave(payload(), draft?.provider_id);
      setDraft(saved);
      return saved;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft could not be saved.");
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
    setError("");
    try {
      // This is the only send call. It follows an explicit click in the
      // confirmation dialog; the transport adds user/confirmed metadata.
      await props.onSend(draft.provider_id, connectionId);
      setConfirmOpen(false);
      props.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The message could not be sent.");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={(open) => !busy && props.onOpenChange(open)}>
        <DialogContent className="max-w-[680px] gap-0 p-0">
          <DialogHeader className="border-b border-charcoal-border px-5 py-4">
            <DialogTitle className="text-sm">{props.replyTo ? "Reply" : "New email"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 px-5 py-4">
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
            <Field label="To" value={to} onChange={setTo} placeholder="name@example.com" />
            <Field label="Subject" value={subject} onChange={setSubject} />
            <label className="grid gap-1.5 text-xs text-cream-muted">
              Message
              <Textarea
                className="min-h-52 resize-y text-sm leading-relaxed"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {error ? (
              <p className="m-0 text-xs text-sage-fg" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-charcoal-border px-5 py-3">
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
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this email?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send “{subject.trim() || "(no subject)"}” to {to}. Misty never sends a draft
              without this confirmation.
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
