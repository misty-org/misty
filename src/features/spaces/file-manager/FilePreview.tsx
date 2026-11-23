import { useEffect, useState } from "react";
import { ErrorState, PaneLoading } from "@misty/ui";
import { EmbeddedUniversalPreview, previewKind, type PreviewText } from "@/features/files";
import { mimeFromName } from "../drive";
import { thumbnailFor } from "./FileItems";
import { messageOf } from "./format";
import type { FileItem } from "./model";
import { sourceOf } from "./sources";

const HEAD_BYTES = 256 * 1024;
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

type Head =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; text?: PreviewText };

function useHead(item: FileItem, wanted: boolean): Head {
  const [head, setHead] = useState<Head>({ status: "idle" });
  const key = `${item.id}:${item.modifiedMs}`;
  useEffect(() => {
    const read = sourceOf(item).readHead;
    if (!wanted || !read) return setHead({ status: "idle" });
    let live = true;
    setHead({ status: "loading" });
    void read(item, HEAD_BYTES).then(
      (got) =>
        live &&
        setHead({
          status: "ready",
          text: got.binary ? undefined : { text: got.text, truncated: got.truncated },
        }),
      (cause) =>
        live &&
        setHead({ status: "failed", message: messageOf(cause, "The file couldn't be read.") }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted]);
  return head;
}

export function FilePreview({ item, compact = false }: { item: FileItem; compact?: boolean }) {
  const mime = mimeFromName(item.name);
  const kind = previewKind(item.name, mime);
  const head = useHead(item, kind === "text");
  const streamed =
    kind === "image" ||
    kind === "video" ||
    kind === "audio" ||
    kind === "pdf" ||
    (kind === "document" && item.size <= DOCUMENT_MAX_BYTES);
  const url = streamed ? (sourceOf(item).previewUrl(item) ?? "") : "";
  const placeholder = kind === "image" ? thumbnailFor(item) : undefined;
  if (head.status === "loading") return <PaneLoading label={`Opening ${item.name}`} />;
  if (head.status === "failed")
    return <ErrorState inline title="This file couldn't be previewed" line={head.message} />;
  return (
    <EmbeddedUniversalPreview
      name={item.name}
      mimeType={mime}
      url={url}
      placeholder={placeholder}
      text={head.status === "ready" ? head.text : undefined}
      compact={compact}
    />
  );
}
