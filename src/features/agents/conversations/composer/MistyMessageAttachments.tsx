import { readAgentsImage } from "@/features/agents/AgentsRuntime";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { MistyImageAttachment } from "../state/conversationTypes";
import { PlaceholderIcon, Surface } from "@/shared/ui";

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
  const [source, setSource] = useState(
    attachment.previewUrl.startsWith("blob:") ? attachment.previewUrl : "",
  );
  useEffect(() => {
    if (attachment.previewUrl.startsWith("blob:")) return;
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
  }, [attachment.id, attachment.previewUrl]);
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
