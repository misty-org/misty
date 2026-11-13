import type { Plugin } from "vite";

// In development the app's windows load from Vite, and Vite's client brings a page back after the
// server restarts, but only a page whose scripts ran. A window that loads or reloads while the
// server is too busy to answer gets its HTML and nothing else: it stays black, and no client is
// there to retry. The same happens when the app's own start stalls on a module that never arrives.
// This runs inline before any module and reloads such a page once the server answers again.

/** How long a page that hasn't started may go without a single resource arriving. */
export const stallMs = 20_000;
/** How often it checks while the page is starting. */
export const checkMs = 2_000;

/**
 * Watches `page` until it has started, then stops. A page has started when its top-level scripts
 * ran and the app's entry, if it has one, finished (`entry.ts` marks `data-misty-starting` on the
 * root while it works and `data-misty-start-failed` if it fails). A page that fails, or stalls
 * with nothing arriving for `stall` ms, reloads once its own address answers, waiting twice as long
 * after each try (up to 30s) so a page that keeps failing doesn't spin.
 *
 * Self-contained: it is inlined into the page as source, so it may use only its arguments.
 */
export function watchForDeadPage(page: Window & typeof globalThis, stall: number, every: number) {
  const key = "misty-dead-page-reloads";
  const root = page.document.documentElement.dataset;
  const now = () => page.performance.now();
  let ready = page.document.readyState !== "loading";
  let scriptFailed = false;
  let lastArrival = now();
  let deadSince: number | null = null;
  let probing = false;

  const tries = () => {
    try {
      return Number(page.sessionStorage.getItem(key) ?? 0) || 0;
    } catch {
      return 0;
    }
  };
  const setTries = (count: number | null) => {
    try {
      if (count === null) page.sessionStorage.removeItem(key);
      else page.sessionStorage.setItem(key, String(count));
    } catch {
      // Without storage each reload starts the wait over, which still recovers.
    }
  };

  page.addEventListener("DOMContentLoaded", () => {
    ready = true;
    lastArrival = now();
  });
  // A top-level script that never arrived. Errors thrown by running code don't target a script.
  page.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof page.HTMLScriptElement) scriptFailed = true;
    },
    true,
  );
  try {
    new page.PerformanceObserver(() => {
      lastArrival = now();
    }).observe({ type: "resource" });
  } catch {
    // Without resource timing a slow start counts as stalled only by the clock.
  }

  const timer = page.setInterval(() => {
    const failed = scriptFailed || "mistyStartFailed" in root;
    if (ready && !failed && !("mistyStarting" in root)) {
      setTries(null);
      page.clearInterval(timer);
      return;
    }
    if (!failed && now() - lastArrival < stall) {
      deadSince = null;
      return;
    }
    deadSince ??= now();
    if (probing || now() - deadSince < Math.min(2_000 * 2 ** tries(), 30_000)) return;
    probing = true;
    page
      .fetch(page.location.href, { cache: "no-store", signal: AbortSignal.timeout(every * 2) })
      .then((response) => {
        if (!response.ok) return;
        setTries(tries() + 1);
        page.clearInterval(timer);
        page.location.reload();
      })
      .catch(() => {
        // Still not answering; try again on the next check.
      })
      .finally(() => {
        probing = false;
      });
  }, every);
}

/** Puts the watchdog at the top of every page the dev server sends. Not in builds. */
export function recoverDeadPages(): Plugin {
  return {
    name: "misty-recover-dead-pages",
    apply: "serve",
    transformIndexHtml: () => [
      {
        tag: "script",
        children: `(${watchForDeadPage.toString()})(window, ${stallMs}, ${checkMs});`,
        injectTo: "head-prepend",
      },
    ],
  };
}
