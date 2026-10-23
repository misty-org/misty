import { spacesApi } from "@/api/spaces/api";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { File, Image, Music2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** A picker tile's preview, fetched once it scrolls near view; other files show their kind. */
export function MistyLibraryPickerThumbnail({
  spaceId,
  item,
}: {
  spaceId: string;
  item: SpaceLibraryItem;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [url, setURL] = useState("");
  const mime = libraryPickerItemMIME(item);
  const previewable =
    /^(image|video)\//.test(mime) || Number(item.file.intrinsic_metadata.width ?? 0) > 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "160px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !previewable) return;
    let current = true;
    let objectURL = "";
    void spacesApi
      .libraryPreview(spaceId, item.id, item.version)
      .then((blob) => {
        if (!current) return;
        objectURL = URL.createObjectURL(blob);
        setURL(objectURL);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [item.id, item.version, previewable, spaceId, visible]);

  const Icon = mime.startsWith("image/")
    ? Image
    : mime.startsWith("video/")
      ? Video
      : mime.startsWith("audio/")
        ? Music2
        : File;
  return (
    <span ref={rootRef} className="grid size-full place-items-center text-cream-muted">
      {url ? (
        <img className="size-full object-cover" src={url} alt="" />
      ) : (
        <Icon className="size-7" />
      )}
    </span>
  );
}

export function libraryPickerItemMIME(item: SpaceLibraryItem): string {
  const metadata = item.file.intrinsic_metadata;
  return String(
    metadata.server_detected_mime_type ??
      metadata.client_declared_mime_type ??
      "application/octet-stream",
  )
    .split(";")[0]
    .toLocaleLowerCase();
}
