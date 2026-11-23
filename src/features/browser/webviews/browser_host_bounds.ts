import { getAppliedAppRenderScale } from "@/shared/hooks/use_app_zoom";
import { cssLengthPx } from "@misty/ui";
import { opaqueColorHex } from "./opaque_color_hex";
import type { BrowserBounds } from "@/features/app-windows";

export function visibleBrowserBounds(host: HTMLElement): BrowserBounds | null {
  if (!host.isConnected || document.visibilityState === "hidden") return null;
  const rect = host.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = right - x;
  const height = bottom - y;
  if (width < 2 || height < 2) return null;
  const cornerRadii = clippedCornerRadii(host, rect);
  const cornerColor = cornerRadii ? paneChromeColor(host) : undefined;
  return browserBoundsAtAppZoom(
    {
      x,
      y,
      width,
      height,
      ...(cornerRadii ? { cornerRadii } : {}),
      ...(cornerColor ? { cornerColor } : {}),
    },
    getAppliedAppRenderScale(),
  );
}

function paneChromeColor(host: HTMLElement): string | undefined {
  const pane = host.closest<HTMLElement>('[data-browser-corner-clip="seam"]');
  if (!pane) return undefined;
  const seam = getComputedStyle(pane, "::before");
  for (const value of [seam.boxShadow, seam.backgroundImage]) {
    for (const match of value.matchAll(/(rgba?|color)\(([^)]+)\)/g)) {
      const hex = opaqueColorHex(match[1]!, match[2]!);
      if (hex) return hex;
    }
  }
  return undefined;
}

function clippedCornerRadii(
  host: HTMLElement,
  rect: DOMRect,
): BrowserBounds["cornerRadii"] | undefined {
  const radii: [number, number, number, number] = [0, 0, 0, 0];
  for (
    let clip: HTMLElement | null = host;
    clip;
    clip = clip.parentElement?.closest<HTMLElement>("[data-browser-corner-clip]") ?? null
  ) {
    const corners = clipCornerRadii(clip, rect);
    for (let index = 0; index < 4; index += 1)
      radii[index] = Math.max(radii[index]!, corners[index]!);
  }
  return radii.some((value) => value > 0) ? radii : undefined;
}

const cornerNames = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

function clipCornerRadii(clip: HTMLElement, rect: DOMRect): [number, number, number, number] {
  const style = getComputedStyle(clip);
  const box = clip.getBoundingClientRect();
  const inset = (padding: string, border: string) =>
    (parseFloat(padding) || 0) + (parseFloat(border) || 0);
  const pad = {
    top: inset(style.paddingTop, style.borderTopWidth),
    right: inset(style.paddingRight, style.borderRightWidth),
    bottom: inset(style.paddingBottom, style.borderBottomWidth),
    left: inset(style.paddingLeft, style.borderLeftWidth),
  };
  const edge = {
    top: box.top + pad.top,
    right: box.right - pad.right,
    bottom: box.bottom - pad.bottom,
    left: box.left + pad.left,
  };
  const meets = (a: number, b: number) => Math.abs(a - b) < 1;
  return cornerNames.map((name) => {
    const [y, x] = name.split("-") as ["top" | "bottom", "left" | "right"];
    if (!meets(rect[y], edge[y]) || !meets(rect[x], edge[x])) return 0;
    const outer =
      clip.dataset.browserCornerClip === "seam"
        ? cssLengthPx(style.getPropertyValue(`--pane-corner-${name}`))
        : parseFloat(style.getPropertyValue(`border-${name}-radius`));
    return Math.max(0, (outer || 0) - Math.max(pad[y], pad[x]));
  }) as [number, number, number, number];
}

function browserBoundsAtAppZoom(bounds: BrowserBounds, appZoom: number): BrowserBounds {
  const zoom = Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1;
  return quantizeBrowserBounds({
    x: bounds.x * zoom,
    y: bounds.y * zoom,
    width: bounds.width * zoom,
    height: bounds.height * zoom,
    ...(bounds.cornerRadii
      ? {
          cornerRadii: bounds.cornerRadii.map((radius) => radius * zoom) as [
            number,
            number,
            number,
            number,
          ],
        }
      : {}),
    ...(bounds.cornerColor ? { cornerColor: bounds.cornerColor } : {}),
  });
}

function quantizeBrowserBounds(bounds: BrowserBounds): BrowserBounds {
  const quantize = (value: number) => Math.round(value * 2) / 2;
  return {
    x: quantize(bounds.x),
    y: quantize(bounds.y),
    width: Math.max(1, quantize(bounds.width)),
    height: Math.max(1, quantize(bounds.height)),
    ...(bounds.cornerRadii ? { cornerRadii: bounds.cornerRadii } : {}),
    ...(bounds.cornerColor ? { cornerColor: bounds.cornerColor } : {}),
  };
}
