import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { ErrorNotification } from "@/shared/ui";
import { errorText, projectApi } from "./projectApi";

const OUTPUT = "misty://terminal-output";
const CLOSED = "misty://terminal-closed";

/** The window's own colors, so the terminal sits in the panel like the rest of it. */
function theme(element: HTMLElement) {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--color-charcoal-card", "#1b1b1b"),
    foreground: read("--color-cream", "#e6e6e6"),
    cursor: read("--color-cream", "#e6e6e6"),
    selectionBackground: "rgba(255, 255, 255, 0.22)",
  };
}

/**
 * The person's own shell in the linked folder. The shell lives as long as the panel shows it;
 * closing the panel ends it.
 */
export default function TerminalPanel({ folder }: { folder: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const id = `terminal:${crypto.randomUUID()}`;
    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      theme: theme(element),
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    let live = true;
    const webview = getCurrentWebview();
    const unlisten = [
      webview.listen<{ id: string; data: string }>(OUTPUT, ({ payload }) => {
        if (payload.id === id) terminal.write(payload.data);
      }),
      webview.listen<{ id: string }>(CLOSED, ({ payload }) => {
        if (payload.id === id) terminal.write("\r\n[The shell ended]\r\n");
      }),
    ];
    void projectApi
      .terminalOpen(id, folder, terminal.cols, terminal.rows)
      .catch((reason) => live && setError(errorText(reason)));
    const typed = terminal.onData(
      (data) => void projectApi.terminalWrite(id, data).catch(() => undefined),
    );
    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      fit.fit();
      // The shell hears the new size once the dragging settles, not on every frame of it.
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () =>
          void projectApi.terminalResize(id, terminal.cols, terminal.rows).catch(() => undefined),
        120,
      );
    });
    observer.observe(element);
    return () => {
      live = false;
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      typed.dispose();
      for (const stop of unlisten) void stop.then((off) => off());
      void projectApi.terminalClose(id).catch(() => undefined);
      terminal.dispose();
    };
  }, [folder]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={host} className="context-terminal min-h-0 flex-1" />
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </div>
  );
}
