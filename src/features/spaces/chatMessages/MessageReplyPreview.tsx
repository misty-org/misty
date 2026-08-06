import { ImageIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Button } from "@/ui";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import { hasAnyAttachment, initials, messageReplyPreviewText } from "./messageHelpers";

/**
 * The quoted line above a reply, with the elbow connector to its parent.
 *
 * The original may have been deleted, so an absent message renders an explicit
 * unavailable state rather than an empty row.
 */
export function MessageReplyPreview({
  avatarUrl,
  message,
  onOpen,
}: {
  avatarUrl: string;
  message?: SpaceMessage;
  onOpen: () => void;
}) {
  return (
    <div className="col-span-2 col-start-1 row-start-1 grid h-7 grid-cols-[44px_minmax(0,1fr)] gap-x-5">
      <div aria-hidden="true" className="relative">
        <span className="absolute left-[21px] top-3 h-5 w-[37px] rounded-tl-md border-l-2 border-t-2 border-cream-muted/55" />
      </div>
      <Button
        variant="ghost"
        className="h-auto min-w-0 justify-start gap-1.5 self-start overflow-hidden border-0 bg-transparent p-0 text-left text-[13px] leading-5 text-cream-muted shadow-none hover:bg-transparent hover:text-cream"
        type="button"
        onClick={onOpen}
        aria-label={
          message ? `Jump to ${message.sender_name}'s message` : "Original message unavailable"
        }
      >
        {message ? (
          <>
            <Avatar className="size-[18px] shrink-0">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[7px] font-semibold">
                {message.sender_kind === "agent" ? "AI" : initials(message.sender_name)}
              </AvatarFallback>
            </Avatar>
            <strong className="shrink-0 font-semibold text-cream-bright">
              @{message.sender_name}
            </strong>
            <span className="min-w-0 truncate text-cream/80">
              {messageReplyPreviewText(message)}
            </span>
            {hasAnyAttachment(message) ? (
              <ImageIcon className="size-4 shrink-0 rounded-[2px] bg-cream p-0.5 text-charcoal-bg" />
            ) : null}
          </>
        ) : (
          <span className="truncate italic">Original message unavailable</span>
        )}
      </Button>
    </div>
  );
}
