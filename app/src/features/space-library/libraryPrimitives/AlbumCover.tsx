import { spacesApi } from "@/services/spaces/api";
import { BookOpenText as LibraryIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** The 4:3 cover image for an album or discovery group, with an icon fallback. */
export function AlbumCover({ spaceId, itemId }: { spaceId: string; itemId?: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setUrl("");
    if (!itemId)
      return () => {
        current = false;
      };
    void spacesApi
      .libraryPreview(spaceId, itemId)
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(""));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, spaceId]);

  return (
    <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-charcoal-card text-cream-muted">
      {url ? (
        <img className="size-full object-cover" src={url} alt="" />
      ) : (
        <LibraryIcon size={26} />
      )}
    </span>
  );
}
