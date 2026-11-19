// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useState } from "react";
import { Surface, Text } from "@/shared/ui";

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ViewHeader({ name, meta }: { name: string; meta?: string }) {
  return (
    <div className="flex h-10 flex-none items-center gap-2 border-b pr-2 pl-3 text-meta">
      <Text tone="default">{name}</Text>
      {meta ? (
        <Text size="caption" tone="muted" className="flex-none">
          {meta}
        </Text>
      ) : null}
    </div>
  );
}

/** An image file: its picture, its size in pixels and bytes. The webview loads `src` itself; the
 * bytes never cross IPC. */
export function ImageFileView({ name, src, size }: { name: string; src: string; size: number }) {
  // Tagged with the URL, so an old decode or failure never shows for the next image.
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const current = loaded && loaded.url === src ? loaded : null;
  const meta = [current ? `${current.width} × ${current.height}` : null, sizeText(size)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader name={name} meta={meta} />
      <Surface
        tone="card"
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
      >
        {failedUrl === src ? (
          <Text wrap size="meta" tone="muted" className="p-4">
            This image couldn't be shown.
          </Text>
        ) : (
          <img
            className="max-h-full max-w-full object-contain"
            src={src}
            alt={name}
            decoding="async"
            onLoad={(event) =>
              setLoaded({
                url: src,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailedUrl(src)}
          />
        )}
      </Surface>
    </div>
  );
}

export function BinaryFileView({ name }: { name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader name={name} />
      <Text wrap size="meta" tone="muted" className="p-4">
        This file isn't text, so it can't be shown here.
      </Text>
    </div>
  );
}
