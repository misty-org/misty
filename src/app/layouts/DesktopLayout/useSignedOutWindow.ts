import { hasTauriInternals } from "@/shared/platform/tauri";
import { LogicalSize, type PhysicalPosition, type PhysicalSize } from "@tauri-apps/api/dpi";
import { getAllWindows, getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useEffect } from "react";

/** Signed-out pages sit in one small window that holds Welcome, Sign in and Create account. */
const SIGNED_OUT_WINDOW_SIZE = { width: 760, height: 640 };

let locked = false;

/** While signed out the window can't be resized or zoomed, including from the titlebar. */
export function isSignedOutWindowLocked(): boolean {
  return locked;
}

type WindowPlacement = { size: PhysicalSize; position: PhysicalPosition; maximized: boolean };

/**
 * Shrinks the window to a fixed, centred size on the signed-out pages and puts back the size,
 * place and zoom it had once someone signs in again.
 */
export function useSignedOutWindow(signedOut: boolean) {
  useEffect(() => {
    if (!signedOut || !hasTauriInternals()) return;
    const window = getCurrentWindow();
    locked = true;
    const shrink = (async (): Promise<WindowPlacement> => {
      if (await window.isFullscreen()) await window.setFullscreen(false);
      const maximized = await window.isMaximized();
      if (maximized) await window.unmaximize();
      const placement = {
        size: await window.innerSize(),
        position: await window.outerPosition(),
        maximized,
      };
      await window.setSize(
        new LogicalSize(SIGNED_OUT_WINDOW_SIZE.width, SIGNED_OUT_WINDOW_SIZE.height),
      );
      await window.center();
      await window.setResizable(false);
      await window.setMaximizable(false);
      return placement;
    })();
    const stopFitting = fitToSignedOutPage(window, shrink);
    return () => {
      locked = false;
      stopFitting();
      void shrink
        .then(async (placement) => {
          await window.setResizable(true);
          await window.setMaximizable(true);
          await window.setSize(placement.size);
          await window.setPosition(placement.position);
          if (placement.maximized) await window.maximize();
        })
        .catch(() => undefined);
    };
  }, [signedOut]);
}

/**
 * Grows the window, while it is the signed-out window, to the height its page needs, so a form
 * never scrolls: never below the signed-out size, never past the screen's free height. A page
 * that marks no content (the welcome) gets the signed-out size back. Refits as the page changes
 * (Sign in to Create account, an extra field, the Google code), once the first shrink is done.
 */
function fitToSignedOutPage(window: Window, ready: Promise<unknown>): () => void {
  let stopped = false;
  let applied = 0;
  let frame = 0;
  const sizeObserver = new ResizeObserver(() => schedule());
  let observed: Element | null = null;

  const fit = () => {
    frame = 0;
    if (stopped) return;
    const page = document.querySelector<HTMLElement>("[data-signed-out-page]");
    const content = page?.querySelector<HTMLElement>("[data-signed-out-content]") ?? null;
    if (content !== observed) {
      if (observed) sizeObserver.unobserve(observed);
      if (content) sizeObserver.observe(content);
      observed = content;
    }
    let height = SIGNED_OUT_WINDOW_SIZE.height;
    if (page && content) {
      const style = getComputedStyle(page);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      // The window's height outside the page (its chrome), plus what the page's column needs.
      const outside = globalThis.innerHeight - page.clientHeight;
      height = Math.max(height, Math.ceil(outside + padding + content.offsetHeight));
    }
    height = Math.min(height, globalThis.screen.availHeight);
    if (height === applied) return;
    applied = height;
    void window
      .setSize(new LogicalSize(SIGNED_OUT_WINDOW_SIZE.width, height))
      .then(() => window.center())
      .catch(() => undefined);
  };
  const schedule = () => {
    if (!frame && !stopped) frame = requestAnimationFrame(fit);
  };
  // Pages swap under the layout without it re-rendering, so watch the document for the swap.
  const pageObserver = new MutationObserver(schedule);
  void ready.then(() => {
    if (stopped) return;
    applied = SIGNED_OUT_WINDOW_SIZE.height;
    pageObserver.observe(document.body, { childList: true, subtree: true });
    schedule();
  });
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    pageObserver.disconnect();
    sizeObserver.disconnect();
  };
}

/** Misty's own app windows (any profile's), not its overlays and docks. */
const isAppWindow = (label: string) => label.startsWith("window-");

/**
 * Adding (or re-entering) an account turns this window into the small sign-in window and hides
 * Misty's other windows meanwhile, so there is only ever one window on screen during sign-in.
 * They come back when this window leaves sign-in, signed in or not. Only for that flow: a log
 * out signs every window out at once, and each hiding the others would leave none.
 */
export function useOtherWindowsHiddenWhileAddingAccount(addingAccount: boolean) {
  useEffect(() => {
    if (!addingAccount || !hasTauriInternals()) return;
    const current = getCurrentWindow().label;
    const hidden = (async (): Promise<Window[]> => {
      const others: Window[] = [];
      for (const window of await getAllWindows()) {
        if (window.label === current || !isAppWindow(window.label)) continue;
        if (!(await window.isVisible().catch(() => false))) continue;
        await window.hide().catch(() => undefined);
        others.push(window);
      }
      return others;
    })();
    return () => {
      void hidden
        .then((others) => Promise.all(others.map((window) => window.show().catch(() => undefined))))
        .then(() => getCurrentWindow().setFocus())
        .catch(() => undefined);
    };
  }, [addingAccount]);
}
