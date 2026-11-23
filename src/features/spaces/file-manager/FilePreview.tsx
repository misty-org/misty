import { useEffect, useState } from "react";
import { ErrorState, PaneLoading } from "@misty/ui";
import { filesApi } from "@/features/agents";
import { disk, driveFileUrl, EmbeddedUniversalPreview, fileUrl } from "@/features/files";
import { driveNative, mimeFromName } from "../drive";
import { driveHasContent, thumbnailFor } from "./FileItems";
import { messageOf } from "./format";
import type { FileItem } from "./model";

const streamed = (mime: string) =>
  mime.startsWith("image/") ||
  mime.startsWith("video/") ||
  mime.startsWith("audio/") ||
  mime === "application/pdf";

type Source =
  { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; url: string };

function useSource(item: FileItem, mime: string): Source {
  const [source, setSource] = useState<Source>({ status: "loading" });
  const key = `${item.id}:${item.modifiedMs}`;
  useEffect(() => {
    const from = item.source;
    if (from.kind === "disk" && streamed(mime)) {
      setSource({ status: "ready", url: fileUrl(from.entry.path, item.modifiedMs) });
      return;
    }
    if (from.kind === "drive" && streamed(mime) && driveHasContent(from.entry.state)) {
      setSource({
        status: "ready",
        url: driveFileUrl(from.entry.space_id, from.entry.path, item.modifiedMs),
      });
      return;
    }
    const read =
      from.kind === "disk"
        ? () => disk.readBytes(from.entry.path)
        : from.kind === "project"
          ? () => filesApi.readBytes(from.path)
          : from.kind === "drive"
            ? () => driveNative.read(from.entry.space_id, from.entry.path)
            : null;
    if (!read)
      return setSource({ status: "failed", message: "This item can't be previewed here." });
    let live = true;
    let url = "";
    setSource({ status: "loading" });
    void read().then(
      (bytes) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setSource({ status: "ready", url });
      },
      (cause) =>
        live &&
        setSource({ status: "failed", message: messageOf(cause, "The file couldn't be read.") }),
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // `item` stands in by its key: the listing makes it again whenever it is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mime]);
  return source;
}

export function FilePreview({ item }: { item: FileItem }) {
  const mime = mimeFromName(item.name);
  const source = useSource(item, mime);
  const placeholder = mime.startsWith("image/") ? thumbnailFor(item) : undefined;
  if (source.status === "loading")
    return placeholder ? (
      <EmbeddedUniversalPreview name={item.name} mimeType={mime} url="" placeholder={placeholder} />
    ) : (
      <PaneLoading label={`Opening ${item.name}`} />
    );
  if (source.status === "failed")
    return <ErrorState inline title="This file couldn't be previewed" line={source.message} />;
  return (
    <EmbeddedUniversalPreview
      name={item.name}
      mimeType={mime}
      url={source.url}
      placeholder={placeholder}
    />
  );
}
