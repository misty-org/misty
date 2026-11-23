import { readAgentsImage } from "@/features/agents/agents_runtime";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { MistyImageAttachment } from "../state/conversation_types";
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

const MOST_KEPT = 200;

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
    <Surface as="span" tone="well" radius="xl" className="grid min-h-24 place-items-center">
      <PlaceholderIcon icon={ImageIcon} />
    </Surface>
  );
}
