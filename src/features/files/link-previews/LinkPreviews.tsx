import { useEffect, useState } from "react";
import { openExternalLink } from "@/shared/platform/open_external_link";
import { Pressable, Skeleton, Surface, Text, Tooltip } from "@misty/ui";
import { knownLinkPreview, loadLinkPreview, type LinkPreview } from "./api";
import { extractLinks } from "./links";
import { useLinkPreviewSetting } from "./settings";

export function LinkPreviews({
  text,
  enabled = true,
  max = 3,
}: {
  text: string;
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
              <Text size="meta" tone="muted">
                {preview.siteName}
              </Text>
            ) : null}
            <Text size="control" weight="medium" tone="bright" lines={2}>
              {preview.title || url}
            </Text>
            {preview.description ? (
              <Text size="meta" tone="muted">
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
