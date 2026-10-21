import { browserSlideExtra } from "@/features/webviews/browserSlide";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { opaqueColorHex } from "./opaqueColorHex";
import type { BrowserBounds } from "./types";

/**
 * Where a page host is on screen, as the bounds its native page takes: clipped to the window,
 * scaled by the app's zoom, with the rounded corners it reaches. Shared by every host of a
 * native page: a tab's (useBrowserWebviewGeometry.ts) and an agent's beside its chat.
 */
export function visibleBrowserBounds(host: HTMLElement): BrowserBounds | null {
  if (!host.isConnected || document.visibilityState === "hidden") return null;
  const rect = host.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = right - x;
  // A page whose bottom is the window's keeps its full size while a panel above it slides, so
  // only its top edge appears to move (browserSlide.ts).
  const slideExtra = rect.bottom >= window.innerHeight - 1 ? browserSlideExtra() : 0;
  const height = bottom - y + slideExtra;
  if (width < 2 || bottom - y < 2) return null;
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

/**
 * The chrome the pane paints around the page's rounded corners, as `#rrggbb`. The pane's seam
 * layer paints it (its inset shadow and corner gradients), so its resolved color already carries
 * the theme and the Space's wash.
 */
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

/** The native page sits above the app, so CSS cannot round it. Report the
 * radius of each rounded corner the page reaches (its own device frame, the
 * workspace pane and the Misty panel edge) so the host can mask it. */
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
  // A clip's border and padding both keep the page inside: a pane's seam is its padding, a
  // page area's outline is its border.
  const inset = (padding: string, border: string) =>
    (parseFloat(padding) || 0) + (parseFloat(border) || 0);
  const pad = {
    top: inset(style.paddingTop, style.borderTopWidth),
    right: inset(style.paddingRight, style.borderRightWidth),
    bottom: inset(style.paddingBottom, style.borderBottomWidth),
    left: inset(style.paddingLeft, style.borderLeftWidth),
  };
  // The page fills the clip's content box.
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
    // Pane corners are masks drawn from the seam geometry, not border radii;
    // custom properties inherit, so only the pane itself reads them.
    const outer =
      clip.dataset.browserCornerClip === "seam"
        ? parseFloat(style.getPropertyValue(`--pane-corner-${name}`))
        : parseFloat(style.getPropertyValue(`border-${name}-radius`));
    return Math.max(0, (outer || 0) - Math.max(pad[y], pad[x]));
  }) as [number, number, number, number];
}

export function browserBoundsAtAppZoom(bounds: BrowserBounds, appZoom: number): BrowserBounds {
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
