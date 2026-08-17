import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { AlertCircle, RotateCcw } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { TerminalSearchOverlay } from "./TerminalSearchOverlay";
import { MISTY_TERMINAL_THEME } from "./terminalTheme";
import {
  bufferBySlot,
  cwdBySlot,
  registerSlot,
  sessionBySlot,
  titleBySlot,
  unregisterSlot,
} from "./terminalRegistry";

type TerminalOutputEvent = { sessionId: string; data: string };
type TerminalExitEvent = { sessionId: string; exitCode?: number };

const BASE_FONT_SIZE = 13;
const MIN_FONT_SCALE = 0.6;
const MAX_FONT_SCALE = 2.0;

export interface TerminalPaneHandle {
  focus: () => void;
  clear: () => void;
  bumpFontScale: (delta: number | "reset") => void;
  copySelection: () => Promise<void>;
  paste: () => Promise<void>;
  toggleSearch: () => void;
}

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
    } = props;

    const hostRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const searchRef = useRef<SearchAddon | null>(null);
    const serializeRef = useRef<SerializeAddon | null>(null);
    const webglRef = useRef<WebglAddon | null>(null);
    const sessionIdRef = useRef("");
    const fontScaleRef = useRef(1);
    const [fontScale, setFontScale] = useState(1);
    const [status, setStatus] = useState<"starting" | "running" | "exited" | "unavailable">(
      "starting",
    );
    const [error, setError] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [restartToken, setRestartToken] = useState(0);

    // Ref-based callback stores so remounts don't blow away the shell.
    const onTitleRef = useRef(onTitleChange);
    const onCwdRef = useRef(onCwdChange);
    const onExitRef = useRef(onExit);
    const onFocusRef = useRef(onFocus);
    useEffect(() => {
      onTitleRef.current = onTitleChange;
      onCwdRef.current = onCwdChange;
      onExitRef.current = onExit;
      onFocusRef.current = onFocus;
    }, [onTitleChange, onCwdChange, onExit, onFocus]);

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
      void invoke("terminal_resize", {
        sessionId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => undefined);
    }, []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      if (tabId) registerSlot(tabId, slotId);

      setStatus("starting");
      setError("");

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
            cursorBlink: true,
            cursorStyle: "block",
            cursorInactiveStyle: "outline",
            drawBoldTextInBrightColors: true,
            fontFamily:
              'ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", "Consolas", monospace',
            fontSize: BASE_FONT_SIZE * fontScaleRef.current,
            lineHeight: 1.3,
            letterSpacing: 0,
            scrollback: 50_000,
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

          term.loadAddon(fit);
          term.loadAddon(search);
          term.loadAddon(serialize);
          term.loadAddon(unicode);
          term.loadAddon(links);
          term.loadAddon(clipboard);
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

              const existing = sessionBySlot.get(slotId);
              if (existing) {
                sessionIdRef.current = existing;
                await invoke("terminal_resize", {
                  sessionId: existing,
                  cols: term.cols,
                  rows: term.rows,
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
                const sessionId = await invoke<string>("terminal_create", {
                  request: {
                    cwd: cwd?.trim() || null,
                    cols: term.cols,
                    rows: term.rows,
                    env: {},
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
            host.removeEventListener("focusin", domFocusHandler);
            unlistens.forEach((fn) => fn());
            // Save scrollback for the next mount before disposing xterm.
            try {
              const snapshot = serialize.serialize();
              bufferBySlot.set(slotId, snapshot);
            } catch {
              /* serialization can fail on some renderers — best effort */
            }
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

    // Apply font-size changes without rebuilding the terminal.
    useEffect(() => {
      const term = terminalRef.current;
      if (!term) return;
      term.options.fontSize = BASE_FONT_SIZE * fontScale;
      fontScaleRef.current = fontScale;
      const id = requestAnimationFrame(fitAndPush);
      return () => cancelAnimationFrame(id);
    }, [fontScale, fitAndPush]);

    useEffect(
      () => () => {
        if (tabId) unregisterSlot(tabId, slotId);
      },
      [tabId, slotId],
    );

    useImperativeHandle(
      handleRef,
      () => ({
        focus: () => terminalRef.current?.focus(),
        clear: () => {
          terminalRef.current?.clear();
          // ^L to the shell so the prompt re-emits and the buffer is truly clean
          const sessionId = sessionIdRef.current;
          if (sessionId) {
            void invoke("terminal_write", { sessionId, data: "\x0c" }).catch(() => undefined);
          }
        },
        bumpFontScale: (delta) => {
          setFontScale((current) => {
            if (delta === "reset") return 1;
            const next = Math.round((current + delta) * 20) / 20;
            return Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, next));
          });
        },
        copySelection: async () => {
          const term = terminalRef.current;
          if (!term) return;
          const selection = term.getSelection();
          if (!selection) return;
          try {
            await navigator.clipboard.writeText(selection);
          } catch {
            /* clipboard may be blocked; user can still ⌘C via native menu */
          }
        },
        paste: async () => {
          const term = terminalRef.current;
          const sessionId = sessionIdRef.current;
          if (!term || !sessionId) return;
          try {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            // xterm handles bracketed paste automatically when the shell
            // enabled it; write() emits the appropriate ^[[200~ / ^[[201~
            // wrappers via paste().
            term.paste(text);
          } catch {
            /* clipboard unavailable */
          }
        },
        toggleSearch: () => setSearchOpen((current) => !current),
      }),
      [],
    );

    return (
      <div
        className="relative h-full min-h-0 w-full bg-[#111312]"
        onClick={() => terminalRef.current?.focus()}
      >
        <div ref={hostRef} className="h-full w-full" />
        {searchOpen && searchRef.current ? (
          <TerminalSearchOverlay
            search={searchRef.current}
            onClose={() => setSearchOpen(false)}
          />
        ) : null}
        {status === "starting" ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#111312]/70 text-xs text-cream-muted">
            Starting shell…
          </div>
        ) : null}
        {status === "unavailable" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#111312] p-6">
            <div className="max-w-sm rounded-md border border-charcoal-border bg-charcoal-card p-4 text-center text-xs text-cream-muted">
              <AlertCircle className="mx-auto mb-2 text-cream-muted" size={20} />
              <p className="mb-3">{error}</p>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded border border-charcoal-border px-2 text-[11px] hover:bg-charcoal-hover"
                onClick={() => setRestartToken((token) => token + 1)}
              >
                <RotateCcw size={11} /> Retry
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
