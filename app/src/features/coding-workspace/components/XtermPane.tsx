import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";

type TerminalOutputEvent = { sessionId: string; data: string };
type TerminalExitEvent = { sessionId: string; exitCode?: number };

interface XtermPaneProps {
  cwd?: string | null;
  env?: Record<string, string>;
  sessionKey: number;
  visible: boolean;
  onTitleChange?: (title: string) => void;
}

export function XtermPane({ cwd, env, sessionKey, visible, onTitleChange }: XtermPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef("");
  const onTitleChangeRef = useRef(onTitleChange);
  const envRef = useRef(env);
  const [status, setStatus] = useState<"starting" | "running" | "exited" | "unavailable">(
    "starting",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    envRef.current = env;
  }, [env]);

  const resize = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    const sessionId = sessionIdRef.current;
    if (!fit || !terminal) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    if (!sessionId) return;
    invoke("terminal_resize", {
      sessionId,
      cols: terminal.cols,
      rows: terminal.rows,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setStatus("starting");
    setError("");

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.4,
      scrollback: 10_000,
      theme: {
        background: "#161616",
        foreground: "#e0e0e0",
        cursor: "#e8d9c0",
        cursorAccent: "#161616",
        selectionBackground: "#2b2b2b",
        black: "#171918",
        brightBlack: "#5a5a5a",
        green: "#a8c090",
        brightGreen: "#c5e89e",
        red: "#d68b80",
        brightRed: "#efab9f",
        yellow: "#d4b880",
        brightYellow: "#e7cf94",
        blue: "#87a9c7",
        brightBlue: "#a9c7e2",
        white: "#e0e0e0",
        brightWhite: "#f1f1f1",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* pane not yet sized */
    }

    let disposed = false;
    let outputUnlisten: UnlistenFn | undefined;
    let exitUnlisten: UnlistenFn | undefined;

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      invoke("terminal_write", { sessionId, data }).catch(() => undefined);
    });

    const titleDisposable = terminal.onTitleChange((title) => {
      if (title) onTitleChangeRef.current?.(title);
    });

    void Promise.all([
      listen<TerminalOutputEvent>("misty://terminal-output", ({ payload }) => {
        if (payload.sessionId === sessionIdRef.current) terminal.write(payload.data);
      }),
      listen<TerminalExitEvent>("misty://terminal-exit", ({ payload }) => {
        if (payload.sessionId !== sessionIdRef.current) return;
        sessionIdRef.current = "";
        setStatus("exited");
        terminal.writeln(
          `\r\n\x1b[90m[process exited${payload.exitCode == null ? "" : ` with code ${payload.exitCode}`}]\x1b[0m`,
        );
      }),
    ])
      .then(([unlistenOutput, unlistenExit]) => {
        if (disposed) {
          unlistenOutput();
          unlistenExit();
          return null;
        }
        outputUnlisten = unlistenOutput;
        exitUnlisten = unlistenExit;
        return invoke<string>("terminal_create", {
          request: {
            cwd: cwd?.trim() || null,
            cols: terminal.cols,
            rows: terminal.rows,
            env: envRef.current ?? {},
          },
        });
      })
      .then((sessionId) => {
        if (!sessionId || disposed) return;
        sessionIdRef.current = sessionId;
        setStatus("running");
        terminal.focus();
      })
      .catch((nextError: unknown) => {
        if (disposed) return;
        setStatus("unavailable");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "The native terminal runtime is only available in the Misty desktop app.",
        );
      });

    return () => {
      disposed = true;
      observer.disconnect();
      inputDisposable.dispose();
      titleDisposable.dispose();
      outputUnlisten?.();
      exitUnlisten?.();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = "";
      if (sessionId) void invoke("terminal_kill", { sessionId }).catch(() => undefined);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, resize, sessionKey]);

  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(id);
  }, [visible, resize]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#161616] p-2">
      <div ref={hostRef} className="h-full w-full" />
      {status === "starting" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#161616]/80 text-xs text-cream-muted">
          Starting shell…
        </div>
      ) : null}
      {status === "unavailable" ? (
        <div className="absolute inset-0 grid place-items-center bg-[#161616] p-6">
          <div className="max-w-sm rounded-md border border-charcoal-border bg-charcoal-card p-4 text-center text-xs text-cream-muted">
            {error}
          </div>
        </div>
      ) : null}
    </div>
  );
}
