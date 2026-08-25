import html2canvas from "html2canvas";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { AiCaptureAttachment } from "./types";

interface Point {
  x: number;
  y: number;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const maximumCaptureBytes = 950 * 1024;

export function MistyRegionCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (capture: AiCaptureAttachment) => void;
  onCancel: () => void;
}) {
  const startRef = useRef<Point | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [onCancel]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startRef.current || capturing) return;
    setRegion(regionFromPoints(startRef.current, { x: event.clientX, y: event.clientY }));
  };
  const finish = async (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || capturing) return;
    const selected = regionFromPoints(start, { x: event.clientX, y: event.clientY });
    if (selected.width < 8 || selected.height < 8) {
      setRegion(null);
      return;
    }
    setRegion(selected);
    setCapturing(true);
    try {
      onCapture(await captureMistyRegion(selected));
    } finally {
      setCapturing(false);
    }
  };

  return createPortal(
    <div
      className="misty-region-capture"
      data-html2canvas-ignore="true"
      aria-label="Select a region for Misty"
      onPointerDown={(event) => {
        if (capturing) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startRef.current = { x: event.clientX, y: event.clientY };
        setRegion({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
      }}
      onPointerMove={move}
      onPointerUp={(event) => void finish(event)}
      onContextMenu={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="misty-region-capture-hint">
        {capturing ? "Attaching capture…" : "Drag around anything Misty should see · Esc to cancel"}
      </div>
      {region ? (
        <div
          className="misty-region-capture-selection"
          style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

export async function captureMistyRegion(region: Region): Promise<AiCaptureAttachment> {
  const scale = Math.min(2, 1280 / Math.max(region.width, region.height));
  const canvas = await html2canvas(document.documentElement, {
    x: region.x + window.scrollX,
    y: region.y + window.scrollY,
    width: region.width,
    height: region.height,
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: null,
    ignoreElements: (element) =>
      element instanceof HTMLElement &&
      (element.hasAttribute("data-html2canvas-ignore") ||
        element.classList.contains("misty-presence")),
  });
  const output = resizeCapture(canvas, 1280);
  const dataUrl = output.toDataURL("image/jpeg", 0.82);
  return captureAttachmentFromDataUrl(dataUrl, output.width, output.height);
}

export async function captureAttachmentFromDataUrl(
  dataUrl: string,
  width: number,
  height: number,
): Promise<AiCaptureAttachment> {
  const normalized = await constrainCaptureSize(dataUrl, width, height);
  dataUrl = normalized.dataUrl;
  width = normalized.width;
  height = normalized.height;
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const decoded = window.atob(encoded);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contentHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id: crypto.randomUUID(),
    name: `Misty capture ${new Date().toLocaleTimeString()}`,
    mimeType: "image/jpeg",
    dataUrl,
    width,
    height,
    contentHash,
  };
}

async function constrainCaptureSize(dataUrl: string, width: number, height: number) {
  if (captureDataUrlByteLength(dataUrl) <= maximumCaptureBytes) {
    return { dataUrl, width, height };
  }
  const image = await loadCaptureImage(dataUrl);
  let scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Misty could not prepare that capture.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.72, 0.6, 0.5, 0.42]) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      if (captureDataUrlByteLength(candidate) <= maximumCaptureBytes) {
        return { dataUrl: candidate, width: canvas.width, height: canvas.height };
      }
    }
    scale *= 0.78;
  }
  throw new Error("That capture is too detailed to attach. Try selecting a smaller region.");
}

function loadCaptureImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Misty could not read that capture."));
    image.src = dataUrl;
  });
}

export function captureDataUrlByteLength(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

function resizeCapture(source: HTMLCanvasElement, maximum: number) {
  const ratio = Math.min(1, maximum / Math.max(source.width, source.height));
  if (ratio === 1) return source;
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(source.width * ratio));
  output.height = Math.max(1, Math.round(source.height * ratio));
  output.getContext("2d")?.drawImage(source, 0, 0, output.width, output.height);
  return output;
}

export function regionFromPoints(start: Point, end: Point): Region {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
