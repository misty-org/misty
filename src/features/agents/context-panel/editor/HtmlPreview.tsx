// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState } from "react";
import { PaneLoading, Surface, Text } from "@misty/ui";
import { filesApi } from "../files/files_api";

const SANDBOX = "allow-forms allow-modals";

type PreviewState =
  { status: "loading" } | { status: "ready"; html: string } | { status: "error"; message: string };

export function HtmlPreview({
  path,
  name,
  reloadKey,
  active,
}: {
  path: string;
  name: string;
  reloadKey: number;
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
  if (state.status === "loading") return <PaneLoading label={`Loading ${name}`} />;
  return (
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
