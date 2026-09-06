import { lazy, useEffect, useSyncExternalStore } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import { usePinnedIds } from "@/shared/hooks/usePinnedIds";
import { SDKSurfaceRegistration } from "@/features/ai-surface/SDKSurfaceRegistration";
import { exportSdkJournalFile } from "@/features/journal/sdkJournalExport";
import { createSdkDrawingAssets } from "./sdkDrawingAssets";
import { createSdkDrawingCollaboration } from "./sdkDrawingCollaboration";
import { createSdkDrawingServices } from "./drawingServices";
import { useDrawingRoomView } from "./hooks/useDrawingRoomView";
import { useSpaceDrawingsView } from "./hooks/useSpaceDrawingsView";
import { DrawingHeaderView } from "./components/DrawingHeaderView";
import { DrawingPreviewHeaderView } from "./components/DrawingPreviewHeaderView";
import { NewDrawingDialogView } from "./components/NewDrawingDialogView";
import { DrawingPreviewView, type DrawingPreviewRuntime } from "./components/DrawingPreviewView";
import type { DrawingsViewRuntime } from "./SpaceDrawingsView";

const Canvas = lazy(() => import("./components/CollaborativeDrawingCanvasView"));
export async function createSdkDrawingsRuntime(input: {
  misty: MistyAppSDK;
  spaceId: string;
  userId: string;
  signal: AbortSignal;
  members: readonly { user_id: string; name: string }[];
  theme: "light" | "dark";
  report(error: unknown): void;
}) {
  const { misty, spaceId, userId, signal: parentSignal, report } = input;
  if (parentSignal.aborted) throw new Error("This Journal view is closed.");
  const key = `misty:drawing-pins:${userId}:${spaceId}`;
  const saved = await misty.storage.local.get(key);
  if (parentSignal.aborted) throw new Error("This Journal view closed while loading preferences.");
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let closed = false,
    pins = typeof saved === "string" ? saved : null,
    theme = input.theme;
  let writes: Promise<void> = Promise.resolve();
  const themeListeners = new Set<() => void>();
  const themeSubscribe = (listener: () => void) => {
    themeListeners.add(listener);
    return () => {
      themeListeners.delete(listener);
    };
  };
  const readTheme = () => theme;
  const storage = {
    getItem: () => pins,
    setItem(_key: string, value: string) {
      if (closed || signal.aborted || pins === value) return;
      pins = value;
      writes = writes
        .catch(() => undefined)
        .then(async () => {
          if (!closed && !signal.aborted) await misty.storage.local.set(key, value);
        });
      void writes.catch(report);
    },
  };
  const collaboration = createSdkDrawingCollaboration(misty, spaceId, signal);
  const assets = createSdkDrawingAssets(misty, spaceId, signal);
  const data = createSdkDrawingServices(
    misty,
    spaceId,
    signal,
    collaboration.closeDocument,
    report,
  );
  const close = () => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    collaboration.close();
    assets.close();
    data.close();
    themeListeners.clear();
    parentSignal.removeEventListener("abort", close);
  };
  parentSignal.addEventListener("abort", close, { once: true });
  const useRoom: DrawingsViewRuntime["useRoom"] = (space, id, user, options) =>
    useDrawingRoomView(collaboration, space, id, user, options);
  const preview: DrawingPreviewRuntime = {
    useRoom,
    hydrate: assets.hydrate,
    exportFile: (file, filename) => {
      if (closed) return Promise.reject(new Error("This Journal view is closed."));
      return exportSdkJournalFile(misty, signal, file, filename).then(() => undefined);
    },
    copyImage: (file) => {
      if (closed || signal.aborted)
        return Promise.reject(new Error("This Journal view is closed."));
      return misty.clipboard.writeImage(file);
    },
    reportError: ({ error }) => report(error),
  };
  const runtime: DrawingsViewRuntime = {
    user: { id: userId, name: input.members.find((member) => member.user_id === userId)?.name },
    members: input.members,
    useList: (space) => useSpaceDrawingsView(space, data.services),
    useRoom,
    usePins: (key, ids, loading) => usePinnedIds(storage, key, ids, loading),
    Header: (props) => <DrawingHeaderView {...props} reportError={({ error }) => report(error)} />,
    PreviewHeader: (props) => (
      <DrawingPreviewHeaderView {...props} reportError={({ error }) => report(error)} />
    ),
    NewDialog: (props) => (
      <NewDrawingDialogView {...props} reportError={({ error }) => report(error)} />
    ),
    Preview: (props) => <DrawingPreviewView {...props} runtime={preview} />,
    Canvas: function SdkCanvas(props) {
      const theme = useSyncExternalStore(themeSubscribe, readTheme);
      return (
        <Canvas
          {...props}
          runtime={{
            theme,
            upload: assets.upload,
            hydrate: assets.hydrate,
            openLink: (url) => {
              if (closed || signal.aborted)
                return Promise.reject(new Error("This Journal view is closed."));
              return misty.links.openExternal(url);
            },
          }}
        />
      );
    },
    renderAiRegistration: (adapter) => (
      <SDKSurfaceRegistration misty={misty} adapter={adapter} report={report} />
    ),
    renderTitle: (title) => <Title misty={misty} title={title} report={report} />,
    renderError: (error) => <ErrorNotice error={error} report={report} />,
  };
  return {
    runtime,
    close,
    setTheme(next: "light" | "dark") {
      if (!closed && theme !== next) {
        theme = next;
        for (const listener of themeListeners) listener();
      }
    },
  };
}
function Title({
  misty,
  title,
  report,
}: {
  misty: MistyAppSDK;
  title: string;
  report(error: unknown): void;
}) {
  useEffect(() => {
    const clean = [...title]
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 160);
    void misty.workspace.setTitle(clean || "Drawings").catch(report);
  }, [misty, title, report]);
  return null;
}
function ErrorNotice({ error, report }: { error: string; report(error: unknown): void }) {
  useEffect(() => report(error), [error, report]);
  return (
    <p role="alert" className="px-4 text-sm text-cream-muted">
      {error}
    </p>
  );
}
