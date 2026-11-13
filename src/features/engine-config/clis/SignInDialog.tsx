// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Signing in to an engine CLI: its own login runs in a terminal in this dialog, the way
 * desktop-cc-gui hands Pi, Oh My Pi and CodeBuddy logins to its built-in terminal. The person
 * finishes the CLI's flow there (a browser page, a code, a key); closing the dialog ends the CLI.
 * When it ends, the caller checks the sign-in again.
 */
import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
  TERMINAL_FONT_SIZE,
  terminalFontFamily,
  terminalTheme,
} from "@/shared/lib/terminal/appearance";
import { loadXterm } from "@/shared/lib/terminal/xtermLoader";
import { Button, Dialog, DialogContent, DialogTitle, Skeleton, Text } from "@/shared/ui";
import { engineName } from "../channels/engines";
import { listenSignIn, signInApi, type SignInRequest } from "./signInApi";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SignInDialog({
  request,
  onClose,
  plain = false,
}: {
  /** null keeps the dialog closed. */
  request: SignInRequest | null;
  /** After the CLI ended or the person closed the dialog. */
  onClose: () => void;
  /** First run: a plain sentence on what to do before the terminal, and a plain ending. */
  plain?: boolean;
}) {
  if (!request) return null;
  return (
    <SignInTerminal
      key={`${request.engine}:${request.provider ?? ""}:${request.signOut ? "out" : "in"}`}
      request={request}
      onClose={onClose}
      plain={plain && !request.signOut}
    />
  );
}

/** What the person does during each first-run sign-in, in plain words. */
function signInSteps(engine: string): string {
  switch (engine) {
    case "agy":
      return (
        "A Google page opens in your browser. Sign in with any Google account, then copy the " +
        "code it shows, paste it below and press Return. It costs nothing."
      );
    case "codex":
      return "A ChatGPT page opens in your browser. Sign in there with your ChatGPT account, then come back here.";
    case "claude":
      return (
        "A Claude page opens in your browser. Sign in there with your Claude account. If it " +
        "shows a code, paste it below and press Return."
      );
    default:
      return "A sign-in page opens in your browser. Finish there. If it shows a code, paste it below and press Return.";
  }
}

function SignInTerminal({
  request,
  onClose,
  plain,
}: {
  request: SignInRequest;
  onClose: () => void;
  plain: boolean;
}) {
  // Started once per dialog: the key above remounts it for another engine or provider.
  const requestRef = useRef(request);
  const [ended, setEnded] = useState<boolean | null>(null);
  const name = engineName(request.engine);
  const title = request.signOut ? `Sign out of ${name}` : `Sign in to ${name}`;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[86vh] w-[720px] max-w-[94vw] flex-col gap-3 p-5"
      >
        <DialogTitle className="pr-10 text-base">{title}</DialogTitle>
        {plain ? (
          <Text size="body" wrap>
            {signInSteps(request.engine)}
          </Text>
        ) : null}
        <CliTerminal
          start={(id, cols, rows) => signInApi.start(requestRef.current, id, cols, rows)}
          onEnded={setEnded}
        />
        {ended !== null ? (
          <p role="status" className="text-sm text-cream-muted">
            {plain
              ? ended
                ? `You're signed in to ${name}.`
                : "The sign-in didn't finish. Close this and press Sign in to try again."
              : ended
                ? `${name} finished.`
                : `${name} ended.`}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant={ended === null ? "secondary" : "primary"} onClick={onClose}>
            {ended === null ? "Cancel" : "Done"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A terminal native code runs for a dialog (a sign-in, or a vendor's installer): the line that
 * runs, then the program's screen, which the person types into. `start` is called once, as the
 * terminal mounts; unmounting ends the program. `onEnded` gets whether it exited cleanly.
 */
export function CliTerminal({
  start,
  onEnded,
  height = 380,
}: {
  start: (id: string, cols: number, rows: number) => Promise<{ command: string }>;
  onEnded: (ok: boolean) => void;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    endedRef.current = onEnded;
  });
  const [command, setCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const id = `cli-terminal-${crypto.randomUUID()}`;
    let disposed = false;
    let term: Terminal | null = null;
    let stopListening: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    let resizeTimer: number | undefined;

    void (async () => {
      try {
        const { Terminal, FitAddon } = await loadXterm();
        if (disposed) return;
        term = new Terminal({
          fontFamily: terminalFontFamily(),
          fontSize: TERMINAL_FONT_SIZE,
          cursorBlink: true,
          scrollback: 2000,
          theme: terminalTheme(),
          macOptionIsMeta: true,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        try {
          fit.fit();
        } catch {
          // A host still being laid out; the observer fits it.
        }
        const live = term;
        stopListening = await listenSignIn(
          id,
          (data) => live.write(data),
          (ok) => {
            if (!disposed) endedRef.current(ok);
          },
        );
        if (disposed) {
          stopListening();
          return;
        }
        live.onData((data) => void signInApi.write(id, data).catch(() => undefined));
        observer = new ResizeObserver(() => {
          try {
            fit.fit();
          } catch {
            return;
          }
          clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(
            () => void signInApi.resize(id, live.cols, live.rows).catch(() => undefined),
            150,
          );
        });
        observer.observe(host);
        const started = await startRef.current(id, live.cols, live.rows);
        if (disposed) {
          void signInApi.close(id).catch(() => undefined);
          return;
        }
        setCommand(started.command);
        setReady(true);
        live.focus();
      } catch (reason) {
        if (!disposed) setError(errorText(reason));
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer?.disconnect();
      stopListening?.();
      term?.dispose();
      void signInApi.close(id).catch(() => undefined);
    };
  }, []);

  return (
    <>
      {command ? (
        <p className="font-mono text-xs break-all text-cream-muted">{command}</p>
      ) : error ? null : (
        <Skeleton className="h-4 w-1/3" />
      )}
      <div
        className="relative shrink-0 overflow-hidden rounded-lg border border-charcoal-border bg-charcoal-card p-2"
        style={{ height }}
      >
        <div ref={hostRef} className="size-full" />
        {!ready && !error ? <Skeleton className="absolute inset-2" /> : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-cream-muted">
          {error}
        </p>
      ) : null}
    </>
  );
}
