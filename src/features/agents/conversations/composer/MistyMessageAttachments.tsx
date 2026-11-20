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

function MistyMessageImage({ attachment }: { attachment: MistyImageAttachment }) {
  // A blob is this session's own upload; a data URL is a picture from an engine's own session.
  const inline = /^(blob|data):/.test(attachment.previewUrl);
  const [source, setSource] = useState(inline ? attachment.previewUrl : "");
  useEffect(() => {
    if (inline) return;
    let active = true;
    let objectURL = "";
    void readAgentsImage(attachment.id)
      .then((blob) => {
        if (!active) return;
        objectURL = URL.createObjectURL(blob);
        setSource(objectURL);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
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
