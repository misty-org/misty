import { readAgentsImage } from "@/features/agents/agentsRuntime";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { MistyImageAttachment } from "./types";

export function MistyMessageAttachments({
  attachments = [],
}: {
  attachments?: MistyImageAttachment[];
}) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-1.5 first:mt-0">
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
  }, [attachment.previewUrl]);
  return source ? (
    <img
      src={source}
      alt={attachment.name}
      className="max-h-64 min-h-24 w-full rounded-xl border border-white/10 object-cover"
    />
  ) : (
    <span className="grid min-h-24 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-cream-muted">
      <ImageIcon className="size-5" />
    </span>
  );
}
