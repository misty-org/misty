import type { MailDraftAttachmentInput } from "@/api/mail";
import { Button } from "@/shared/ui";
import { Paperclip, X } from "lucide-react";

export function AttachmentChips(props: {
  attachments: MailDraftAttachmentInput[];
  onRemove: (index: number) => void;
}) {
  if (!props.attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {props.attachments.map((att, idx) => (
        <span
          key={`${att.filename}-${idx}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-charcoal-border bg-charcoal-card/60 px-2 text-xs text-cream-muted"
        >
          <Paperclip className="size-3 text-cream-faint" />
          <span className="max-w-[160px] truncate text-[11px]">{att.filename}</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="size-4 p-0 text-cream-faint hover:text-cream"
            aria-label={`Remove ${att.filename}`}
            onClick={() => props.onRemove(idx)}
          >
            <X className="size-3" />
          </Button>
        </span>
      ))}
    </div>
  );
}

export function readFileAsDraftAttachment(file: File): Promise<MailDraftAttachmentInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        data: base64,
        inline: false,
      });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}
