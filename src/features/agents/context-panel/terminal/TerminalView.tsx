// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { IDisposable, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn, SetupState } from "@misty/ui";
import { errorText } from "../projectApi";
import {
  TERMINAL_FONT_SIZE,
  terminalFontFamily,
  terminalTheme,
} from "@/shared/lib/terminal/appearance";
import { attachInputBridge } from "./inputBridge";
import { createInputQueue } from "./inputQueue";
import { createPathLinkProvider, createUrlLinkProvider, isMacPlatform } from "./links";
import { openTerminalPath, openTerminalUrl } from "./openTarget";
import {
  ensureTerminalOutputListener,
  hasTerminalSession,
  markTerminalClosed,
  markTerminalOpened,
  setTerminalWriter,
  terminalBacklog,
} from "./sessions";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TERMINAL_GONE, terminalApi } from "./terminalApi";
import { loadXterm, type XtermModules } from "@/shared/lib/terminal/xtermLoader";
import { uiPx } from "@misty/ui";

/** The shell hears a new size this long after the last change: one call per frame stalled the
 * native side and made dragging feel sticky. */
const PTY_RESIZE_DEBOUNCE_MS = 150;

/** xterm measures glyphs when it opens or its font changes; a webfont that hasn't loaded yet
 * would bake the fallback's cell size into the canvas. `document.fonts.load` takes a CSS font
 * shorthand. */
function waitForFontLoad(family: string, size: number): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  try {
    return fonts.load(`${size}px ${family}`).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // A shorthand the browser can't parse: nothing to wait on; the caller measures anyway.
    return Promise.resolve();
  }
}

/**
 * One xterm for the open tab, made again for each tab (keyed by its id). The shell itself lives
 * on across mounts and its kept output replays into the new view, so closing the panel or
 * switching tabs loses nothing. Memoized so the panel's own renders never redraw the terminal.
 */
export const TerminalView = memo(function TerminalView({
  id,
  cwd,
  onCloseTab,
}: {
  id: string;
  cwd: string;
  onCloseTab: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Until the shell answers, lines stand in for its first output; a tab with kept output has it.
  const [ready, setReady] = useState(() => Boolean(terminalBacklog(id)));
  // Trying again builds the view and asks for the shell once more.
  const [attempt, setAttempt] = useState(0);
  const [xterm, setXterm] = useState<XtermModules | null>(null);
  // The live xterm, for the context menu outside the setup effect.
  const liveTermRef = useRef<Terminal | null>(null);
  const getTerminal = useCallback(() => liveTermRef.current, []);

  // xterm loads on first mount; the module-level promise keeps it for every later tab. A failed
  // load is tried again with the rest of the setup.
  useEffect(() => {
    if (xterm) return;
    let cancelled = false;
    ensureTerminalOutputListener();
    void loadXterm()
      .then((modules) => {
        if (!cancelled) setXterm(modules);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [xterm, attempt]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !xterm) return;
    let resizeTimer: number | undefined;
    let termRef: Terminal | null = null;
    let fitRef: FitAddon | null = null;
    const disposables: IDisposable[] = [];
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let fontLoadVersion = 0;
    let disposed = false;

    const safeFit = () => {
      try {
        fitRef?.fit();
      } catch {
        // A zero-size host in the middle of layout; the next resize refits.
      }
    };

    // Fit every frame so the canvas follows a drag, and tell the shell once it settles.
    const schedulePtyResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = undefined;
        if (termRef && hasTerminalSession(id)) {
          void terminalApi.resize(id, termRef.cols, termRef.rows).catch(() => undefined);
        }
      }, PTY_RESIZE_DEBOUNCE_MS);
    };

    // xterm ignores setting the same family again, so a face that finished loading after the
    // first measure would never be picked up. Passing through a probe value takes xterm down its
    // public option path (measure the cells, reset the glyph atlas), then the real family returns.
    const remeasureFont = (family: string) => {
      const term = termRef;
      if (!term) return;
      term.options.fontFamily = `${family}, monospace`;
      term.options.fontFamily = family;
    };

    // Waits for the face, then measures again. A late arrival (after unmount, or after a newer
    // font) leaves the view alone.
    const refitAfterFontLoad = (family: string, size: number) => {
      const version = ++fontLoadVersion;
      void waitForFontLoad(family, size).then(() => {
        if (disposed || !termRef || version !== fontLoadVersion) return;
        remeasureFont(family);
        safeFit();
        schedulePtyResize();
      });
    };

    try {
      const { Terminal, FitAddon, WebglAddon, ImageAddon } = xterm;
      const fontFamily = terminalFontFamily();
      const term = new Terminal({
        fontFamily,
        fontSize: uiPx(TERMINAL_FONT_SIZE),
        cursorBlink: true,
        scrollback: 5000,
        theme: terminalTheme("panel"),
        // Option as meta, so word jumps (⌥← and ⌥→) reach readline on macOS.
        macOptionIsMeta: true,
        // ⌥-click opens a link on macOS (links.ts); xterm's own ⌥-click would also move the
        // shell's cursor to the clicked cell. Keep it where the two can't meet.
        altClickMovesCursor: !isMacPlatform(),
      });
      termRef = term;
      liveTermRef.current = term;
      const fit = new FitAddon();
      fitRef = fit;
      term.loadAddon(fit);
      term.open(host);
      try {
        // GPU rendering; when the GPU context is lost xterm goes back to its DOM renderer.
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // No WebGL here: the DOM renderer stays.
      }
      try {
        // Pictures a program prints: Sixel and iTerm2's inline images (imgcat, chafa,
        // `fastfetch --logo-type iterm`). Loaded before the backlog, so images in it draw too.
        if (ImageAddon) term.loadAddon(new ImageAddon());
      } catch {
        // Without it, image data shows as nothing rather than breaking the terminal.
      }

      const backlog = terminalBacklog(id);
      if (backlog) term.write(backlog);
      setTerminalWriter(id, (data) => term.write(data));

      const openSession = () =>
        terminalApi
          .open(id, cwd, term.cols, term.rows)
          .then(() => {
            // Unmounted before the shell was ready: the shell outlives the view by design, so
            // leave it, but touch nothing of a view that is gone.
            if (disposed) return;
            markTerminalOpened(id);
            // The font may have refitted while the shell was starting: send the latest size.
            schedulePtyResize();
            setError(null);
            setReady(true);
          })
          .catch((reason: unknown) => {
            if (!disposed) setError(errorText(reason));
          });

      // The shell starts at its final size: what the person's shell files print at once
      // (fastfetch, a banner) is laid out for the rows it is told, and a tool that draws upward
      // over a shorter screen loses its top lines. So wait for the face (briefly) and for the
      // panel's layout to settle, measure, then start it.
      safeFit();
      void Promise.race([
        waitForFontLoad(fontFamily, uiPx(TERMINAL_FONT_SIZE)),
        new Promise((resolve) => window.setTimeout(resolve, 300)),
      ])
        .catch(() => undefined)
        .then(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        .then(() => {
          if (disposed) return;
          remeasureFont(fontFamily);
          safeFit();
          void openSession();
        });
      refitAfterFontLoad(fontFamily, uiPx(TERMINAL_FONT_SIZE));

      // Absolute paths and web addresses in output open with a modifier-click (links.ts).
      disposables.push(
        term.registerLinkProvider(
          createPathLinkProvider({ term, cwd, onActivate: openTerminalPath }),
        ),
        term.registerLinkProvider(createUrlLinkProvider({ term, onActivate: openTerminalUrl })),
      );

      // One ordered channel for what is typed: xterm's onData plus the WKWebView input-method
      // fallback (inputBridge.ts).
      const inputQueue = createInputQueue({
        write: (data) => terminalApi.write(id, data),
        reopen: () => {
          markTerminalClosed(id);
          return openSession();
        },
        isSessionGone: (reason) => String(reason).includes(TERMINAL_GONE),
      });
      disposables.push(attachInputBridge(term, inputQueue.send));

      resizeObserver = new ResizeObserver(() => {
        safeFit();
        schedulePtyResize();
      });
      resizeObserver.observe(host);

      // Follow the window's theme as it changes.
      themeObserver = new MutationObserver(() => {
        term.options.theme = terminalTheme("panel");
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    } catch (reason: unknown) {
      setError(errorText(reason));
    }

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      for (const disposable of disposables) disposable.dispose();
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      if (termRef) {
        setTerminalWriter(id, null);
        termRef.dispose();
        liveTermRef.current = null;
      }
    };
  }, [xterm, id, cwd, attempt]);

  return (
    <TerminalContextMenu getTerminal={getTerminal} cwd={cwd} onCloseTab={onCloseTab}>
      <div className="terminal-view">
        <div
          ref={hostRef}
          // Out of sight until the shell answers, so its cursor doesn't blink behind the setup line;
          // still laid out, so xterm measures the panel and the shell starts at its final size.
          className={cn("terminal-host", !ready && "invisible")}
          data-testid="terminal-host"
          hidden={Boolean(error)}
        />
        {error || !ready ? (
          <SetupState
            tool="terminal"
            error={error}
            onRetry={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          />
        ) : null}
      </div>
    </TerminalContextMenu>
  );
});
