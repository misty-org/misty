import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "@/shared/ui";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { ClipboardCopy, ImageDown, Palette } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readDrawingElements } from "../collaboration/drawingSceneStore";
import type { useDrawingRoomView, DrawingUser } from "../hooks/useDrawingRoomView";
import type { DrawingAssetReference } from "../types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { SpaceDrawing } from "../types";

interface DrawingExportData {
  elements: readonly NonDeleted<ExcalidrawElement>[];
  files: BinaryFiles;
  viewBackgroundColor: string;
}

const previewSurfaceColors = ["#101010", "#191b1f", "#122126", "#211e08", "#211b1b", "#f4f0e8"];

export interface DrawingPreviewRuntime {
  useRoom(
    space: string,
    id: string,
    user: DrawingUser,
    options?: { publishPresence?: boolean },
  ): ReturnType<typeof useDrawingRoomView>;
  hydrate(space: string, id: string, reference: DrawingAssetReference): Promise<BinaryFileData>;
  exportFile(file: Blob, filename: string): Promise<void>;
  copyImage(file: Blob): Promise<void>;
  reportError(input: {
    accountId: string;
    scope: string;
    title: string;
    error: unknown;
    target: { kind: "route"; href: string };
  }): void;
}
export function DrawingPreviewView(props: {
  drawing: SpaceDrawing;
  user: DrawingUser;
  runtime: DrawingPreviewRuntime;
}) {
  const { runtime } = props;
  const room = runtime.useRoom(props.drawing.space_id, props.drawing.id, props.user, {
    publishPresence: false,
  });
  const [previewUrl, setPreviewUrl] = useState("");
  const [exportData, setExportData] = useState<DrawingExportData | null>(null);
  const [previewSurface, setPreviewSurface] = useState(previewSurfaceColors[0]);
  const [empty, setEmpty] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const previewBlobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef("");

  useEffect(() => {
    const session = room.session;
    if (!session || !room.synced) return;
    let active = true;
    let renderTimer: number | null = null;
    let renderRevision = 0;

    const replacePreviewUrl = (nextUrl: string) => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      if (!nextUrl) previewBlobRef.current = null;
    };

    const renderPreview = async () => {
      const revision = ++renderRevision;
      setRenderFailed(false);
      try {
        const { exportToBlob, getNonDeletedElements } = await import("@excalidraw/excalidraw");
        const elements = getNonDeletedElements(readDrawingElements(session.elements));
        if (!active || revision !== renderRevision) return;
        if (elements.length === 0) {
          setEmpty(true);
          setExportData(null);
          replacePreviewUrl("");
          return;
        }

        const hydratedFiles = await Promise.allSettled(
          Array.from(session.files.values()).map(async (reference) => {
            const file = await runtime.hydrate(props.drawing.space_id, props.drawing.id, reference);
            return [file.id, file] as const;
          }),
        );
        if (!active || revision !== renderRevision) return;
        const files = Object.fromEntries(
          hydratedFiles.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
        ) as BinaryFiles;
        const storedBackgroundColor = session.scene.get("viewBackgroundColor");
        const viewBackgroundColor =
          typeof storedBackgroundColor === "string" ? storedBackgroundColor : "#ffffff";
        const blob = await exportToBlob({
          elements,
          files,
          mimeType: "image/png",
          maxWidthOrHeight: 1600,
          exportPadding: 48,
          appState: { exportBackground: false, viewBackgroundColor },
        });
        if (!active || revision !== renderRevision) return;
        setEmpty(false);
        setExportData({ elements, files, viewBackgroundColor });
        previewBlobRef.current = blob;
        replacePreviewUrl(URL.createObjectURL(blob));
      } catch {
        if (!active || revision !== renderRevision) return;
        setRenderFailed(true);
        setExportData(null);
        replacePreviewUrl("");
      }
    };

    const scheduleRender = () => {
      if (renderTimer != null) window.clearTimeout(renderTimer);
      renderTimer = window.setTimeout(() => void renderPreview(), 180);
    };

    session.elements.observeDeep(scheduleRender);
    session.scene.observe(scheduleRender);
    session.files.observe(scheduleRender);
    void renderPreview();
    return () => {
      active = false;
      renderRevision += 1;
      if (renderTimer != null) window.clearTimeout(renderTimer);
      session.elements.unobserveDeep(scheduleRender);
      session.scene.unobserve(scheduleRender);
      session.files.unobserve(scheduleRender);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
      previewBlobRef.current = null;
    };
  }, [props.drawing.id, props.drawing.space_id, room.session, room.synced, runtime]);

  const reportExportFailure = (title: string, error: unknown) => {
    runtime.reportError({
      accountId: props.user.id,
      scope: `drawings:${props.drawing.space_id}:${props.drawing.id}:export`,
      title,
      error,
      target: {
        kind: "route",
        href: `/spaces/${encodeURIComponent(props.drawing.space_id)}/drawings/${encodeURIComponent(props.drawing.id)}`,
      },
    });
  };

  const exportPng = () => {
    if (!previewBlobRef.current) return;
    void runtime
      .exportFile(previewBlobRef.current, drawingExportFilename(props.drawing.title, "png"))
      .catch((error) => reportExportFailure("PNG could not be exported", error));
  };

  const exportSvg = async () => {
    if (!exportData) return;
    try {
      const { exportToSvg } = await import("@excalidraw/excalidraw");
      const svg = await exportToSvg({
        elements: exportData.elements,
        files: exportData.files,
        exportPadding: 48,
        appState: {
          exportBackground: false,
          viewBackgroundColor: exportData.viewBackgroundColor,
        },
      });
      await runtime.exportFile(
        new Blob([svg.outerHTML], { type: "image/svg+xml;charset=utf-8" }),
        drawingExportFilename(props.drawing.title, "svg"),
      );
    } catch (error) {
      reportExportFailure("SVG could not be exported", error);
    }
  };

  const copyPng = async () => {
    if (!exportData) return;
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: exportData.elements,
        files: exportData.files,
        mimeType: "image/png",
        maxWidthOrHeight: 1600,
        exportPadding: 48,
        appState: { exportBackground: false, viewBackgroundColor: exportData.viewBackgroundColor },
      });
      await runtime.copyImage(blob);
    } catch (error) {
      reportExportFailure("PNG could not be copied", error);
    }
  };

  const renderExportChoices = () => (
    <>
      <DropdownMenuItem disabled={!previewUrl} onSelect={exportPng}>
        PNG
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!exportData} onSelect={() => void exportSvg()}>
        SVG
      </DropdownMenuItem>
    </>
  );

  let content: ReactNode;
  if (room.error || renderFailed) {
    content = <PreviewMessage>Preview unavailable</PreviewMessage>;
  } else if (empty) {
    content = <PreviewMessage>This canvas is empty</PreviewMessage>;
  } else if (!previewUrl) {
    content = (
      <PreviewMessage>
        <Spinner className="size-4" />
        Preparing preview…
      </PreviewMessage>
    );
  } else {
    content = (
      <div className="grid h-full min-h-0 place-items-center overflow-hidden p-4">
        <img
          className="max-h-full max-w-full object-contain"
          src={previewUrl}
          alt={`Preview of ${props.drawing.title || "untitled drawing"}`}
        />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg">
      <div
        className="misty-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto border-b border-charcoal-border bg-charcoal-card px-2"
        role="toolbar"
        aria-label="Excalidraw preview tools"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-8 shrink-0 gap-1.5 px-2 text-xs text-cream-muted hover:text-cream-bright"
              disabled={!exportData}
            >
              <ImageDown className="size-3.5" />
              Export image
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {renderExportChoices()}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs text-cream-muted hover:text-cream-bright"
          disabled={!exportData}
          onClick={() => void copyPng()}
        >
          <ClipboardCopy className="size-3.5" />
          Copy to clipboard
        </Button>
        <BackgroundChoices value={previewSurface} onChange={setPreviewSurface} />
      </div>
      <div className="min-h-0 transition-colors" style={{ backgroundColor: previewSurface }}>
        {content}
      </div>
    </div>
  );
}

function BackgroundChoices(props: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 pr-1">
      {previewSurfaceColors.map((color, index) => (
        <button
          key={color}
          type="button"
          className={`size-5 shrink-0 rounded-md border border-charcoal-border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-cream-muted ${props.value === color ? "ring-2 ring-[#a89cf7] ring-offset-1 ring-offset-charcoal-card" : ""}`}
          style={{ backgroundColor: color }}
          aria-label={`Preview background ${index + 1}`}
          aria-pressed={props.value === color}
          onClick={() => props.onChange(color)}
        />
      ))}
      <label
        className="relative ml-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-cream-muted outline-none transition-colors hover:bg-charcoal-hover hover:text-cream-bright focus-within:ring-2 focus-within:ring-cream-muted"
        title="Choose a custom preview background"
      >
        <Palette className="pointer-events-none size-3.5" />
        <input
          type="color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={props.value}
          aria-label="Custom preview background"
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function PreviewMessage(props: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2 text-xs text-cream-muted">{props.children}</div>
    </div>
  );
}

function drawingExportFilename(title: string, extension: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled drawing";
  return `${safeTitle}.${extension}`;
}
