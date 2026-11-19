import { SetupState, Surface, Text } from "@/shared/ui";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { useEffect, useState } from "react";
import {
  acquireDrawingSession,
  releaseDrawingSession,
} from "../journal/drawings/collaboration/drawingCollaboration";
import { readDrawingElements } from "../journal/drawings/collaboration/drawingSceneStore";
import { hydrateDrawingBinaryFile } from "../journal/drawings/drawingAssets";
import { frameScene } from "../journal/drawings/drawingFrames";

export interface BoardFrameEmbedProps {
  spaceId: string;
  /** The drawing. */
  itemId: string;
  /** The frame element's id. */
  partId: string;
}

type FrameView =
  | { state: "joining" }
  | { state: "failed"; error: string }
  | { state: "missing" }
  | { state: "ready"; url: string; title: string };

/**
 * One frame of a whiteboard, live and read-only: it joins the drawing's room without showing up
 * as a collaborator, and redraws the frame as an SVG whenever the board changes.
 */
export function BoardFrameEmbed(props: BoardFrameEmbedProps) {
  const [view, setView] = useState<FrameView>({ state: "joining" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let joined = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let url = "";
    let detach: (() => void) | undefined;
    const replaceUrl = (next: string) => {
      if (url) URL.revokeObjectURL(url);
      url = next;
    };
    setView({ state: "joining" });

    acquireDrawingSession(props.spaceId, props.itemId, { publishPresence: false })
      .then((session) => {
        if (!active) {
          releaseDrawingSession(props.spaceId, props.itemId, { publishPresence: false });
          return;
        }
        joined = true;
        const render = async () => {
          const current = ++revision;
          try {
            const scene = frameScene(readDrawingElements(session.elements), props.partId);
            if (!scene) {
              if (active && current === revision) setView({ state: "missing" });
              return;
            }
            const { exportToSvg } = await import("@excalidraw/excalidraw");
            const used = new Set(
              scene.elements.flatMap((element) =>
                element.type === "image" && element.fileId ? [element.fileId] : [],
              ),
            );
            const hydrated = await Promise.allSettled(
              [...session.files.values()]
                .filter((reference) => used.has(reference.fileId as never))
                .map(async (reference) => {
                  const file = await hydrateDrawingBinaryFile(
                    props.spaceId,
                    props.itemId,
                    reference,
                  );
                  return [file.id, file] as const;
                }),
            );
            const files = Object.fromEntries(
              hydrated.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
            ) as BinaryFiles;
            const background = session.scene.get("viewBackgroundColor");
            const svg = await exportToSvg({
              elements: scene.elements,
              files,
              exportPadding: 16,
              exportingFrame: scene.frame,
              appState: {
                exportBackground: false,
                viewBackgroundColor: typeof background === "string" ? background : "#ffffff",
              },
            });
            if (!active || current !== revision) return;
            replaceUrl(
              URL.createObjectURL(
                new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" }),
              ),
            );
            setView({
              state: "ready",
              url,
              title: (typeof scene.frame.name === "string" && scene.frame.name) || "Frame",
            });
          } catch {
            if (active && current === revision)
              setView({ state: "failed", error: "The frame couldn't be drawn." });
          }
        };
        const schedule = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void render(), 180);
        };
        const start = () => {
          session.elements.observeDeep(schedule);
          session.files.observe(schedule);
          session.scene.observe(schedule);
          void render();
        };
        const onSync = (synced: boolean) => {
          if (!synced) return;
          session.provider.off("sync", onSync);
          start();
        };
        if (session.provider.synced) start();
        else session.provider.on("sync", onSync);
        detach = () => {
          session.provider.off("sync", onSync);
          session.elements.unobserveDeep(schedule);
          session.files.unobserve(schedule);
          session.scene.unobserve(schedule);
        };
      })
      .catch(() => {
        if (active) setView({ state: "failed", error: "The whiteboard couldn't be reached." });
      });

    return () => {
      active = false;
      revision += 1;
      if (timer) clearTimeout(timer);
      detach?.();
      replaceUrl("");
      if (joined) releaseDrawingSession(props.spaceId, props.itemId, { publishPresence: false });
    };
  }, [props.spaceId, props.itemId, props.partId, attempt]);

  if (view.state === "missing") {
    return (
      <Text size="control" tone="muted">
        This frame is no longer on the whiteboard
      </Text>
    );
  }
  if (view.state !== "ready") {
    return (
      <SetupState
        size="inline"
        tool="whiteboard frame"
        label="Joining the whiteboard"
        error={view.state === "failed" ? view.error : null}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  return (
    <Surface tone="board" radius="md" className="grid place-items-center overflow-hidden p-2">
      <img className="max-h-128 max-w-full object-contain" src={view.url} alt={view.title} />
    </Surface>
  );
}

export default BoardFrameEmbed;
