import { useEffect, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Pressable, Skeleton, Surface, Text, Tooltip } from "@/shared/ui";
import { knownLinkPreview, loadLinkPreview, type LinkPreview } from "./api";
import { extractLinks } from "./links";
import { useLinkPreviewSetting } from "./settings";

/**
 * A card under a message for each link in it, like the unfurls in Discord or Instagram:
 * thumbnail, site, title and a line of description. A link with no preview shows nothing,
 * since the message already holds the link itself.
 */
export function LinkPreviews({
  text,
  enabled = true,
  max = 3,
}: {
  text: string;
  /** False while a message is still being written, so half a link is never fetched. */
  enabled?: boolean;
  max?: number;
}) {
  const allowed = useLinkPreviewSetting((state) => state.enabled);
  if (!enabled || !allowed) return null;
  const links = extractLinks(text, max);
  if (!links.length) return null;
  return (
    <div role="list" className="mt-2 grid gap-2" aria-label="Link previews">
      {links.map((link) => (
        <LinkPreviewCard key={link} url={link} />
      ))}
    </div>
  );
}

function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(() =>
    knownLinkPreview(url),
  );
  useEffect(() => {
    let live = true;
    if (knownLinkPreview(url) === undefined)
      void loadLinkPreview(url).then((value) => live && setPreview(value));
    return () => {
      live = false;
    };
  }, [url]);
  if (preview === undefined) return <LinkPreviewSkeleton />;
  if (!preview) return null;
  return (
    <div role="listitem" className="m-0 max-w-115">
      <Tooltip content={url}>
        <Pressable
          wash="card"
          className="flex w-full items-stretch overflow-hidden rounded-lg border text-left transition-colors"
          onClick={() => void openExternalLink(url)}
        >
          {preview.image ? (
            <img
              src={preview.image}
              alt=""
              className="aspect-video w-32 shrink-0 object-cover"
              loading="lazy"
            />
          ) : null}
          <span className="grid min-w-0 content-center gap-0.5 py-2 pl-3 pr-3">
            {preview.siteName ? (
              <Text tone="muted" className="text-xs">
                {preview.siteName}
              </Text>
            ) : null}
            <Text tone="bright" lines={2} className="text-sm font-medium leading-snug">
              {preview.title || url}
            </Text>
            {preview.description ? (
              <Text tone="muted" className="text-xs">
                {preview.description}
              </Text>
            ) : null}
          </span>
        </Pressable>
      </Tooltip>
    </div>
  );
}

function LinkPreviewSkeleton() {
  return (
    <Surface
      tone="none"
      edge="hairline"
      radius="lg"
      className="m-0 flex max-w-115 overflow-hidden"
      aria-hidden="true"
    >
      <Skeleton className="aspect-video w-32 shrink-0 rounded-none" />
      <span className="grid flex-1 content-center gap-2 p-3">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-3 w-4/5" />
      </span>
    </Surface>
  );
}
