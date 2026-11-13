// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState } from "react";
import { SkeletonDocument, Surface, Text } from "@/shared/ui";
import { filesApi } from "../files/filesApi";

/** No `allow-same-origin`: the page gets an opaque origin, so it can't read storage or anything
 * of the app, and navigating the window and popups stay blocked. What it can load was settled
 * natively (only its own folder's stylesheets, images and fonts, inlined, under a policy that
 * forbids sending anything anywhere): see src-tauri/features/project/html_preview.rs. */
const SANDBOX = "allow-forms allow-modals";

type PreviewState =
  { status: "loading" } | { status: "ready"; html: string } | { status: "error"; message: string };

/**
 * An HTML file rendered from what is saved on disk, not the unsaved draft. `reloadKey` reads it
 * again. A hidden tab renders nothing, so a page's animations stop while it isn't shown. Each read
 * after the first keeps the last page on screen until the new one is ready.
 */
export function HtmlPreview({
  path,
  name,
  reloadKey,
  active,
}: {
  path: string;
  name: string;
  reloadKey: number;
  /** False while the tab is hidden; the frame isn't there then. */
  active: boolean;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    if (!active) return;
    let live = true;
    filesApi
      .htmlPreview(path)
      .then((html) => live && setState({ status: "ready", html }))
      .catch((reason: unknown) => {
        if (!live) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        // A read that failed after one that worked leaves that page up.
        setState((last) => (last.status === "ready" ? last : { status: "error", message }));
      });
    return () => {
      live = false;
    };
  }, [active, path, reloadKey]);

  if (!active) return null;
  if (state.status === "error") {
    return (
      <Text wrap size="meta" tone="muted" role="alert" className="p-4">
        {state.message}
      </Text>
    );
  }
  if (state.status === "loading") return <SkeletonDocument label={name} />;
  return (
    // A page that sets no background reads on white, as a browser shows it.
    <Surface tone="board" className="flex min-h-0 w-full flex-1">
      <iframe
        key={reloadKey}
        srcDoc={state.html}
        title={name}
        sandbox={SANDBOX}
        className="min-h-0 w-full flex-1 border-0"
      />
    </Surface>
  );
}
