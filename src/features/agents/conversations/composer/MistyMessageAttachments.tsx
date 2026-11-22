import { readAgentsImage } from "@/features/agents/AgentsRuntime";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { MistyImageAttachment } from "../state/conversationTypes";
import { PlaceholderIcon, Surface } from "@misty/ui";

export function MistyMessageAttachments({
  attachments = [],
}: {
  attachments?: MistyImageAttachment[];
}) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 grid max-w-105 grid-cols-2 gap-1.5 first:mt-0">
      {attachments.map((attachment) => (
        <MistyMessageImage key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

/** How many chat pictures stay ready to draw, newest used last; past it the oldest is let go. */
const MOST_KEPT = 200;

/**
 * Chat pictures read from `misty.db` this session, by attachment id, so a message drawn again (scrolling
 * back, switching chats and returning) shows its picture at once instead of reading it anew.
 */
const kept = new Map<string, { url?: string; reading: Promise<string> }>();

function keptPicture(id: string): Promise<string> {
  const known = kept.get(id);
  if (known) {
    kept.delete(id);
    kept.set(id, known);
    return known.reading;
  }
  const entry: { url?: string; reading: Promise<string> } = {
    reading: readAgentsImage(id).then((blob) => {
      entry.url = URL.createObjectURL(blob);
      return entry.url;
    }),
  };
  entry.reading.catch(() => kept.delete(id));
  kept.set(id, entry);
  for (const [oldest, gone] of kept) {
    if (kept.size <= MOST_KEPT) break;
    kept.delete(oldest);
    if (gone.url) URL.revokeObjectURL(gone.url);
  }
  return entry.reading;
}

function MistyMessageImage({ attachment }: { attachment: MistyImageAttachment }) {
  // A blob is this session's own upload; a data URL is a picture from an engine's own session.
  const inline = /^(blob|data):/.test(attachment.previewUrl);
  const [source, setSource] = useState(() =>
    inline ? attachment.previewUrl : (kept.get(attachment.id)?.url ?? ""),
  );
  useEffect(() => {
    if (inline) return;
    let active = true;
    void keptPicture(attachment.id)
      .then((url) => {
        if (active) setSource(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [attachment.id, attachment.previewUrl, inline]);
  return source ? (
    <img
      src={source}
      alt={attachment.name}
      className="max-h-64 min-h-24 w-full rounded-xl border object-cover"
    />
  ) : (
    <Surface
      as="span"
      tone="well"
      edge="hairline"
      radius="xl"
      className="grid min-h-24 place-items-center"
    >
      <PlaceholderIcon icon={ImageIcon} />
    </Surface>
  );
}
