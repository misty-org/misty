// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { IDisposable, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn, SetupState } from "@misty/ui";
import { errorText } from "../project_api";
import {
  TERMINAL_FONT_SIZE,
  terminalFontFamily,
  terminalTheme,
} from "@/shared/lib/terminal/appearance";
import { attachInputBridge } from "./input_bridge";
import { createInputQueue } from "./input_queue";
import { createPathLinkProvider, createUrlLinkProvider, isMacPlatform } from "./links";
import { openTerminalPath, openTerminalUrl } from "./open_target";
import {
  ensureTerminalOutputListener,
  hasTerminalSession,
  markTerminalClosed,
  markTerminalOpened,
  setTerminalWriter,
  terminalBacklog,
} from "./sessions";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TERMINAL_GONE, terminalApi } from "./terminal_api";
import { loadXterm, type XtermModules } from "@/shared/lib/terminal/xterm_loader";
import { uiPx } from "@misty/ui";

const PTY_RESIZE_DEBOUNCE_MS = 150;

function waitForFontLoad(family: string, size: number): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  try {
    return fonts.load(`${size}px ${family}`).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

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
  const [ready, setReady] = useState(() => Boolean(terminalBacklog(id)));
  const [attempt, setAttempt] = useState(0);
  const [xterm, setXterm] = useState<XtermModules | null>(null);
  const liveTermRef = useRef<Terminal | null>(null);
  const getTerminal = useCallback(() => liveTermRef.current, []);

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
      } catch {}
    };

    const schedulePtyResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = undefined;
        if (termRef && hasTerminalSession(id)) {
          void terminalApi.resize(id, termRef.cols, termRef.rows).catch(() => undefined);
        }
      }, PTY_RESIZE_DEBOUNCE_MS);
    };

    const remeasureFont = (family: string) => {
      const term = termRef;
      if (!term) return;
      term.options.fontFamily = `${family}, monospace`;
      term.options.fontFamily = family;
    };

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
        cursorStyle: "bar",
        cursorWidth: 1,
        scrollback: 5000,
        theme: terminalTheme("panel"),
        macOptionIsMeta: true,
        altClickMovesCursor: !isMacPlatform(),
      });
      termRef = term;
      liveTermRef.current = term;
      const fit = new FitAddon();
      fitRef = fit;
      term.loadAddon(fit);
      term.open(host);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {}
      try {
        if (ImageAddon) term.loadAddon(new ImageAddon());
      } catch {}

      const backlog = terminalBacklog(id);
      if (backlog) term.write(backlog);
      setTerminalWriter(id, (data) => term.write(data));

      const openSession = () =>
        terminalApi
          .open(id, cwd, term.cols, term.rows)
          .then(() => {
            if (disposed) return;
            markTerminalOpened(id);
            schedulePtyResize();
            setError(null);
            setReady(true);
          })
          .catch((reason: unknown) => {
            if (!disposed) setError(errorText(reason));
          });

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

      disposables.push(
        term.registerLinkProvider(
          createPathLinkProvider({ term, cwd, onActivate: openTerminalPath }),
        ),
        term.registerLinkProvider(createUrlLinkProvider({ term, onActivate: openTerminalUrl })),
      );

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
