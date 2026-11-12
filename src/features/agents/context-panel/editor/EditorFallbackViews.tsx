// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useState } from "react";

function dataUrlBytes(url: string): number | null {
  const comma = url.indexOf(",");
  if (comma < 0 || !url.slice(0, comma).includes(";base64")) return null;
  const body = url.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ViewHeader({ name, meta }: { name: string; meta?: string }) {
  return (
    <div className="editor-head">
      <span className="editor-head-name">{name}</span>
      {meta ? <span className="editor-head-note">{meta}</span> : null}
    </div>
  );
}

/** An image file: its picture, its size in pixels and bytes. Too large to read shows why. */
export function ImageFileView({ name, dataUrl }: { name: string; dataUrl: string | null }) {
  // Tagged with the URL, so an old decode never shows for the next image.
  const [dims, setDims] = useState<{ url: string; width: number; height: number } | null>(null);
  const current = dims && dims.url === dataUrl ? dims : null;
  const bytes = dataUrl ? dataUrlBytes(dataUrl) : null;
  const meta = [
    current ? `${current.width} × ${current.height}` : null,
    bytes !== null ? sizeText(bytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader name={name} meta={meta || undefined} />
      <div className="editor-image">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={name}
            onLoad={(event) =>
              setDims({
                url: dataUrl,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        ) : (
          <p className="editor-empty">This image is larger than 5 MB, too large to preview.</p>
        )}
      </div>
    </div>
  );
}

export function BinaryFileView({ name }: { name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader name={name} />
      <p className="editor-empty">This file isn't text, so it can't be shown here.</p>
    </div>
  );
}
