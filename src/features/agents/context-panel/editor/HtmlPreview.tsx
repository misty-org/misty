// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState } from "react";
import { Skeleton } from "@/shared/ui";
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
 * again. A hidden tab renders nothing, so a page's animations stop while it isn't shown.
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
    setState({ status: "loading" });
    filesApi
      .htmlPreview(path)
      .then((html) => live && setState({ status: "ready", html }))
      .catch(
        (reason: unknown) =>
          live &&
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : String(reason),
          }),
      );
    return () => {
      live = false;
    };
  }, [active, path, reloadKey]);

  if (!active) return null;
  if (state.status === "error") {
    return (
      <p role="alert" className="editor-empty">
        {state.message}
      </p>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="grid gap-2 p-4" aria-hidden="true">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  return (
    <iframe
      key={reloadKey}
      srcDoc={state.html}
      title={name}
      sandbox={SANDBOX}
      className="editor-html-frame"
    />
  );
}
