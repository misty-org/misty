import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon, type ISearchResultChangeEvent } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { TerminalPaneOverlays, type TerminalSessionStatus } from "./TerminalPaneOverlays";
import {
  localTerminalEnvironment,
  preflightSshEnvironment,
  terminalEnvironmentRequest,
  trustSshHost,
  type SshHostKeyStatus,
  type TerminalEnvironment,
} from "./sshEnvironments";
import { MISTY_TERMINAL_THEME } from "./terminalTheme";
import {
  bufferBySlot,
  cwdBySlot,
  registerSlot,
  sessionBySlot,
  titleBySlot,
} from "./terminalRegistry";
import { selectTerminalPreferences, useSettingsStore } from "@/features/settings";
import { useShallow } from "zustand/react/shallow";
import { useTerminalPaneHandle, type TerminalPaneHandle } from "./useTerminalPaneHandle";

export type { TerminalPaneHandle } from "./useTerminalPaneHandle";
export type { TerminalSessionStatus } from "./TerminalPaneOverlays";

type TerminalOutputEvent = { sessionId: string; data: string };
type TerminalExitEvent = { sessionId: string; exitCode?: number };

const MISTY_MONOSPACE_STACK =
  'ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", "Consolas", monospace';
const CURSOR_STYLES = ["block", "bar", "underline"] as const;
interface TerminalPaneProps {
  slotId: string;
  tabId: string | null;
  cwd?: string | null;
  visible: boolean;
  focused: boolean;
  onTitleChange?: (title: string) => void;
  onCwdChange?: (cwd: string) => void;
  onExit?: (exitCode: number | undefined) => void;
  onFocus?: () => void;
  environment?: TerminalEnvironment;
  onSessionStatusChange?: (status: TerminalSessionStatus) => void;
  onSearchResultsChange?: (result: ISearchResultChangeEvent) => void;
  onCancelSsh?: () => void;
}

/** Single xterm.js instance backed by a PTY session in Rust. */
export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(props, handleRef) {
    const {
      slotId,
      tabId,
      cwd,
      visible,
      focused,
      onTitleChange,
      onCwdChange,
      onExit,
      onFocus,
      onSessionStatusChange,
      onSearchResultsChange,
      onCancelSsh,
    } = props;
    const environment = props.environment ?? localTerminalEnvironment;

    const hostRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const searchRef = useRef<SearchAddon | null>(null);
    const serializeRef = useRef<SerializeAddon | null>(null);
    const webglRef = useRef<WebglAddon | null>(null);
    const sessionIdRef = useRef("");
    const fontScaleRef = useRef(1);
    const [fontScale, setFontScale] = useState(1);
    const terminalPreferences = useSettingsStore(
      useShallow((state) => selectTerminalPreferences(state.settings?.document)),
    );
    // xterm is built once inside a rAF callback, so the constructor reads
    // through a ref rather than the render-time value.
    const preferencesRef = useRef(terminalPreferences);
    preferencesRef.current = terminalPreferences;
    const [status, setStatus] = useState<TerminalSessionStatus>("starting");
    const [error, setError] = useState("");
    const [hostKey, setHostKey] = useState<SshHostKeyStatus | null>(null);
    const [restartToken, setRestartToken] = useState(0);

    // Ref-based callback stores so remounts don't blow away the shell.
    const onTitleRef = useRef(onTitleChange);
    const onCwdRef = useRef(onCwdChange);
    const onExitRef = useRef(onExit);
    const onFocusRef = useRef(onFocus);
    const onSearchResultsRef = useRef(onSearchResultsChange);
    useEffect(() => {
      onTitleRef.current = onTitleChange;
      onCwdRef.current = onCwdChange;
      onExitRef.current = onExit;
      onFocusRef.current = onFocus;
      onSearchResultsRef.current = onSearchResultsChange;
    }, [onTitleChange, onCwdChange, onExit, onFocus, onSearchResultsChange]);

    useEffect(() => onSessionStatusChange?.(status), [onSessionStatusChange, status]);

    const fitAndPush = useCallback(() => {
      const term = terminalRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      const host = hostRef.current;
      const pixelWidth = host ? Math.round(host.clientWidth) : 0;
      const pixelHeight = host ? Math.round(host.clientHeight) : 0;
      void invoke("terminal_resize", {
        sessionId,
        cols: term.cols,
        rows: term.rows,
        pixelWidth: pixelWidth > 0 ? pixelWidth : undefined,
        pixelHeight: pixelHeight > 0 ? pixelHeight : undefined,
      }).catch(() => undefined);
    }, []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      if (tabId) registerSlot(tabId, slotId);

      setStatus("starting");
      setError("");
      setHostKey(null);

      let disposed = false;
      const unlistens: UnlistenFn[] = [];
      let cleanup: (() => void) | null = null;

      // Double rAF: first frame paints the pane, second frame measures it.
      // Only then do we build xterm + spawn the shell so the PTY starts with
      // the true column count — Powerlevel10k caches PS1 layout based on
      // COLUMNS at startup, so this is what killed prompt redraws before.
      const frame1 = requestAnimationFrame(() => {
        const frame2 = requestAnimationFrame(() => {
          if (disposed) return;
          const term = new Terminal({
            allowProposedApi: true,
            allowTransparency: false,
            cursorBlink: preferencesRef.current.cursorBlink,
            cursorStyle: CURSOR_STYLES[preferencesRef.current.cursorStyleIndex] ?? "block",
            cursorInactiveStyle: "outline",
            drawBoldTextInBrightColors: true,
            fontFamily: preferencesRef.current.fontFamily || MISTY_MONOSPACE_STACK,
            fontSize: preferencesRef.current.fontSize * fontScaleRef.current,
            lineHeight: 1.3,
            letterSpacing: 0,
            scrollback: preferencesRef.current.scrollback,
            smoothScrollDuration: 80,
            macOptionIsMeta: true,
            rightClickSelectsWord: true,
            theme: MISTY_TERMINAL_THEME,
          });

          const fit = new FitAddon();
          const search = new SearchAddon();
          const serialize = new SerializeAddon();
          const unicode = new Unicode11Addon();
          const links = new WebLinksAddon((event, uri) => {
            event.preventDefault();
            void openSystemExternalLink(uri);
          });
          const clipboard = new ClipboardAddon();
          const image = new ImageAddon({
            sixelSupport: true,
            sixelScrolling: true,
            iipSupport: true,
            enableSizeReports: true,
          });

          term.loadAddon(fit);
          term.loadAddon(search);
          term.loadAddon(serialize);
          term.loadAddon(unicode);
          term.loadAddon(links);
          term.loadAddon(clipboard);
          term.loadAddon(image);
          term.unicode.activeVersion = "11";

          term.open(host);

          // WebGL renderer with canvas fallback. Some machines / Tauri
          // configs can't get a GL context; failing loud would kill the
          // whole terminal, so we swallow the error and let xterm fall back.
          try {
            const webgl = new WebglAddon();
            webgl.onContextLoss(() => webgl.dispose());
            term.loadAddon(webgl);
            webglRef.current = webgl;
          } catch {
            /* canvas renderer takes over automatically */
          }

          try {
            fit.fit();
          } catch {
            /* container may still be zero-sized during the very first frame */
          }

          terminalRef.current = term;
          fitRef.current = fit;
          searchRef.current = search;
          serializeRef.current = serialize;

          // OSC 0 / OSC 2 — set-window-title
          term.parser.registerOscHandler(0, (data) => {
            if (data) {
              titleBySlot.set(slotId, data);
              onTitleRef.current?.(data);
            }
            return true;
          });
          term.parser.registerOscHandler(2, (data) => {
            if (data) {
              titleBySlot.set(slotId, data);
              onTitleRef.current?.(data);
            }
            return true;
          });
          // OSC 7 — cwd reporting. Format is file://hostname/path.
          term.parser.registerOscHandler(7, (data) => {
            const match = /^file:\/\/[^/]*(\/.+)$/.exec(data);
            if (match?.[1]) {
              try {
                const decoded = decodeURIComponent(match[1]);
                cwdBySlot.set(slotId, decoded);
                onCwdRef.current?.(decoded);
              } catch {
                /* malformed OSC payload */
              }
            }
            return true;
          });
          // OSC 133 shell-integration prompt marks — silently accept so
          // they don't leak into the visible buffer if the shell emits
          // them without our tooling being wired up yet.
          term.parser.registerOscHandler(133, () => true);

          // Restore serialized scrollback from the previous mount, if any.
          // Must run before the reader thread starts writing new bytes so
          // the restored buffer sits above whatever the shell prints next.
          const restore = bufferBySlot.get(slotId);
          if (restore) term.write(restore);

          // Bell — flash a subtle inset ring instead of dinging.
          term.onBell(() => {
            host.animate(
              [
                { boxShadow: "inset 0 0 0 2px rgba(232,217,192,0.35)" },
                { boxShadow: "inset 0 0 0 2px rgba(232,217,192,0)" },
              ],
              { duration: 240, easing: "ease-out" },
            );
          });

          const inputDisposable = term.onData((data) => {
            const sessionId = sessionIdRef.current;
            if (!sessionId) return;
            void invoke("terminal_write", { sessionId, data }).catch(() => undefined);
          });

          const focusDisposable = term.onSelectionChange(() => onFocusRef.current?.());
          const searchResultsDisposable = search.onDidChangeResults((result) =>
            onSearchResultsRef.current?.(result),
          );
          const domFocusHandler = () => onFocusRef.current?.();
          host.addEventListener("focusin", domFocusHandler);

          const observer = new ResizeObserver(fitAndPush);
          observer.observe(host);

          // Set up event listeners BEFORE spawning so first bytes aren't
          // dropped. `terminal_create` may resolve before the listen()
          // registration lands if we do it the other way around.
          const setup = async () => {
            try {
              const outputUnlisten = await listen<TerminalOutputEvent>(
                "misty://terminal-output",
                ({ payload }) => {
                  if (payload.sessionId === sessionIdRef.current) term.write(payload.data);
                },
              );
              const exitUnlisten = await listen<TerminalExitEvent>(
                "misty://terminal-exit",
                ({ payload }) => {
                  if (payload.sessionId !== sessionIdRef.current) return;
                  const closedId = sessionIdRef.current;
                  sessionIdRef.current = "";
                  if (sessionBySlot.get(slotId) === closedId) {
                    sessionBySlot.delete(slotId);
                    bufferBySlot.delete(slotId);
                  }
                  setStatus("exited");
                  term.writeln(
                    `\r\n\x1b[90m[process exited${payload.exitCode == null ? "" : ` with code ${payload.exitCode}`}]\x1b[0m`,
                  );
                  onExitRef.current?.(payload.exitCode);
                },
              );
              unlistens.push(outputUnlisten, exitUnlisten);
              if (disposed) return;

              const pixelWidth = host ? Math.round(host.clientWidth) : 0;
              const pixelHeight = host ? Math.round(host.clientHeight) : 0;

              const existing = sessionBySlot.get(slotId);
              if (existing) {
                sessionIdRef.current = existing;
                await invoke("terminal_resize", {
                  sessionId: existing,
                  cols: term.cols,
                  rows: term.rows,
                  pixelWidth: pixelWidth > 0 ? pixelWidth : undefined,
                  pixelHeight: pixelHeight > 0 ? pixelHeight : undefined,
                }).catch(() => undefined);
                // Nudge the shell to redraw its prompt after reattach so
                // the visible line matches the shell's cursor tracker.
                // ^L is the widely-supported "redraw" input for zsh/bash
                // when zle is active.
                if (!restore) {
                  void invoke("terminal_write", {
                    sessionId: existing,
                    data: "\x0c",
                  }).catch(() => undefined);
                }
              } else {
                if (environment.kind === "ssh") {
                  setStatus("connecting");
                  const preflight = await preflightSshEnvironment(environment.ssh);
                  if (preflight.state === "confirmation_required") {
                    setHostKey(preflight);
                    setStatus("awaiting_fingerprint");
                    return;
                  }
                  if (preflight.state !== "trusted") {
                    throw new Error(preflight.message);
                  }
                }
                const sessionId = await invoke<string>("terminal_create", {
                  request: {
                    cwd: cwd?.trim() || null,
                    cols: term.cols,
                    rows: term.rows,
                    pixelWidth: pixelWidth > 0 ? pixelWidth : undefined,
                    pixelHeight: pixelHeight > 0 ? pixelHeight : undefined,
                    env: {},
                    environment: terminalEnvironmentRequest(environment),
                  },
                });
                if (!sessionId || disposed) return;
                sessionIdRef.current = sessionId;
                sessionBySlot.set(slotId, sessionId);
              }
              setStatus("running");
              term.focus();
            } catch (nextError) {
              if (disposed) return;
              setStatus("unavailable");
              setError(
                nextError instanceof Error
                  ? nextError.message
                  : "The native terminal runtime is only available in the Misty desktop app.",
              );
            }
          };
          void setup();

          cleanup = () => {
            observer.disconnect();
            inputDisposable.dispose();
            focusDisposable.dispose();
            searchResultsDisposable.dispose();
            host.removeEventListener("focusin", domFocusHandler);
            unlistens.forEach((fn) => fn());
            // Save scrollback only while the PTY still belongs to this slot.
            // Explicit shell/tab closes remove the session first, so cleanup
            // cannot resurrect their buffer after disposal.
            if (sessionBySlot.has(slotId)) {
              try {
                const snapshot = serialize.serialize();
                bufferBySlot.set(slotId, snapshot);
              } catch {
                /* serialization can fail on some renderers — best effort */
              }
            } else bufferBySlot.delete(slotId);
            sessionIdRef.current = "";
            try {
              webglRef.current?.dispose();
            } catch {
              /* ignore */
            }
            webglRef.current = null;
            term.dispose();
            terminalRef.current = null;
            fitRef.current = null;
            searchRef.current = null;
            serializeRef.current = null;
          };
        });
        // Track second-frame handle only when needed for cancellation
        void frame2;
      });

      return () => {
        disposed = true;
        cancelAnimationFrame(frame1);
        cleanup?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slotId, restartToken]);

    const confirmFingerprint = useCallback(async () => {
      if (environment.kind !== "ssh" || !hostKey?.fingerprints[0]) return;
      setStatus("connecting");
      setError("");
      try {
        const result = await trustSshHost(environment.ssh, hostKey.fingerprints[0]);
        if (result.state !== "trusted") throw new Error(result.message);
        setHostKey(null);
        setRestartToken((token) => token + 1);
      } catch (nextError) {
        setStatus("unavailable");
        setError(nextError instanceof Error ? nextError.message : "Host confirmation failed.");
      }
    }, [environment, hostKey]);

    // Re-fit when the pane becomes visible (e.g., switched back to this tab
    // or unhidden a split). Uses rAF so layout has settled.
    useEffect(() => {
      if (!visible) return;
      const id = requestAnimationFrame(fitAndPush);
      return () => cancelAnimationFrame(id);
    }, [visible, fitAndPush]);

    // Focus this pane whenever it's marked as the focused split.
    useEffect(() => {
      if (focused) terminalRef.current?.focus();
    }, [focused]);

    // Apply font and cursor changes without rebuilding the terminal. Both the
    // Cmd +/- scale and the Terminal settings feed the same font size, so they
    // are applied together rather than fighting over `term.options`.
    useEffect(() => {
      const term = terminalRef.current;
      if (!term) return;
      term.options.fontSize = terminalPreferences.fontSize * fontScale;
      term.options.fontFamily = terminalPreferences.fontFamily || MISTY_MONOSPACE_STACK;
      term.options.cursorBlink = terminalPreferences.cursorBlink;
      term.options.cursorStyle = CURSOR_STYLES[terminalPreferences.cursorStyleIndex] ?? "block";
      term.options.scrollback = terminalPreferences.scrollback;
      fontScaleRef.current = fontScale;
      const id = requestAnimationFrame(fitAndPush);
      return () => cancelAnimationFrame(id);
    }, [
      fitAndPush,
      fontScale,
      terminalPreferences.cursorBlink,
      terminalPreferences.cursorStyleIndex,
      terminalPreferences.fontFamily,
      terminalPreferences.fontSize,
      terminalPreferences.scrollback,
    ]);

    useTerminalPaneHandle({
      handleRef,
      terminalRef,
      searchRef,
      sessionIdRef,
      setFontScale,
    });

    return (
      <div
        className="relative h-full min-h-0 w-full bg-[#111312]"
        onClick={() => terminalRef.current?.focus()}
      >
        <div ref={hostRef} className="h-full w-full px-0.5" />
        <TerminalPaneOverlays
          status={status}
          error={error}
          hostKey={hostKey}
          onCancelSsh={onCancelSsh}
          onConfirmFingerprint={() => void confirmFingerprint()}
          onRestart={() => setRestartToken((token) => token + 1)}
        />
      </div>
    );
  },
);
