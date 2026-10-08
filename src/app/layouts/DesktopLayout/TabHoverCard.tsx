import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { Portal } from "@/shared/ui";

const showAfterMs = 600;

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface Shown {
  rect: DOMRect;
  view: WorkspaceView;
  label: string;
}

/**
 * One card for the tab strip: the hovered tab's title, site and last snapshot,
 * like Chrome's tab hover cards. `bind` returns handlers for a tab element, so
 * the strip's structure is unchanged. Pages sit above the app, so they pause
 * behind the card while it shows.
 */
export function useTabHoverCards() {
  const timer = useRef(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const preview = useBrowserRuntimeStore((state) =>
    shown ? state.previews[shown.view.id] : undefined,
  );
  const reason = "tab-hover-card";
  useEffect(() => {
    if (!shown) return;
    setBrowserWebviewsSuspended(true, reason);
    return () => setBrowserWebviewsSuspended(false, reason);
  }, [shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const hide = () => {
    window.clearTimeout(timer.current);
    setShown(null);
  };
  const bind = (view: WorkspaceView | null | undefined, label: string, disabled: boolean) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      window.clearTimeout(timer.current);
      if (disabled || !view) return;
      const target = event.currentTarget;
      timer.current = window.setTimeout(() => {
        if (target.isConnected) setShown({ rect: target.getBoundingClientRect(), view, label });
      }, showAfterMs);
    },
    onPointerLeave: hide,
    onPointerDown: hide,
  });
  const url =
    shown?.view.surfaceId === "browser" ? parseBrowserViewState(shown.view.state).url : "";
  const card = shown ? (
    <Portal>
      <div
        role="tooltip"
        className="pointer-events-none fixed z-[60] w-64 overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card shadow-xl"
        style={{
          left: Math.min(shown.rect.left, window.innerWidth - 272),
          top: shown.rect.bottom + 6,
        }}
      >
        <div className="grid gap-0.5 px-3 py-2">
          <span className="line-clamp-2 text-sm text-cream-bright">{shown.label}</span>
          {url ? <span className="truncate text-xs text-cream-muted">{siteOf(url)}</span> : null}
        </div>
        {preview?.dataUrl ? (
          <img
            src={preview.dataUrl}
            alt=""
            className="aspect-[16/10] w-full border-t border-charcoal-border object-cover object-top"
          />
        ) : null}
      </div>
    </Portal>
  ) : null;
  return { bind, card };
}
