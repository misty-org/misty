// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import type { Terminal } from "@xterm/xterm";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  TERMINAL_FONT_SIZE,
  terminalFontFamily,
  terminalTheme,
} from "@/shared/lib/terminal/appearance";
import { loadXterm } from "@/shared/lib/terminal/xterm_loader";
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DisclosureButton,
  FieldError,
  Input,
  Label,
  SetupState,
  Spinner,
  Surface,
  Text,
  DialogFooter,
} from "@misty/ui";
import { engineName } from "../channels/engines";
import { listenSignIn, signInApi, type SignInRequest, type SignInStarted } from "./sign_in_api";
import { uiPx } from "@misty/ui";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SignInDialog({
  request,
  onClose,
}: {
  request: SignInRequest | null;
  onClose: () => void;
}) {
  if (!request) return null;
  return (
    <SignInTerminal
      key={`${request.engine}:${request.provider ?? ""}:${request.signOut ? "out" : "in"}`}
      request={request}
      onClose={onClose}
    />
  );
}

const ENGINE_PAGES: Record<string, string> = {
  gemini: "A Google page opens in your browser. Sign in there with your Google account",
  kimi: "A Kimi page opens in your browser. Sign in there and allow access",
  qoder: "A Qoder page opens in your browser. Sign in there with your Qoder account",
  "qoder-cn": "A Qoder page opens in your browser. Sign in there with your Qoder account",
  grok: "An xAI page opens in your browser. Sign in there with your X or xAI account",
};

export function signInSteps(started: SignInStarted, engine: string, signOut: boolean): string {
  const name = engineName(engine);
  if (started.asks === "menu") {
    return signOut
      ? `${name} signs out in its own screen. Open Show details, and if it asks which account, ` +
          "pick one with the arrow keys and press Return."
      : `${name} asks how you'd like to sign in. Open Show details, pick an option with the ` +
          "arrow keys and press Return, then follow the page it opens.";
  }
  if (signOut) return `Signing you out of ${name}.`;
  switch (engine) {
    case "agy":
      return (
        "A Google page opens in your browser. Sign in with any Google account, then copy the " +
        "code it shows and paste it here. It costs nothing."
      );
    case "claude":
      return (
        "A Claude page opens in your browser. Sign in there with your Claude account. If it " +
        "shows a code, copy it and paste it here."
      );
    case "codex":
      return "A ChatGPT page opens in your browser. Sign in there with your ChatGPT account, then come back here.";
  }
  if (started.asks === "code") {
    return "A sign-in page opens in your browser. Sign in there, then copy the code it shows and paste it here.";
  }
  const page = ENGINE_PAGES[engine];
  if (page) return `${page}, then come back here.`;
  return "A sign-in page opens in your browser. Finish there, then come back here.";
}

function endingLine(ok: boolean, name: string, signOut: boolean): string {
  if (signOut) {
    return ok ? `You're signed out of ${name}.` : `${name} stopped before it signed you out.`;
  }
  return ok
    ? `You're signed in to ${name}.`
    : "The sign-in didn't finish. Close this and press Sign in to try again.";
}

function SignInTerminal({ request, onClose }: { request: SignInRequest; onClose: () => void }) {
  const requestRef = useRef(request);
  const idRef = useRef<string | null>(null);
  const [started, setStarted] = useState<SignInStarted | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [ended, setEnded] = useState<boolean | null>(null);
  const [details, setDetails] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const name = engineName(request.engine);
  const signOut = Boolean(request.signOut);
  const title = signOut ? `Sign out of ${name}` : `Sign in to ${name}`;
  const running = ended === null && startError === null;
  const takesCode = started?.asks === "code" && running;

  const start = async (id: string, cols: number, rows: number) => {
    idRef.current = id;
    try {
      const result = await signInApi.start(requestRef.current, id, cols, rows);
      setStarted(result);
      return result;
    } catch (reason) {
      setStartError(errorText(reason));
      throw reason;
    }
  };

  let line: string | null;
  if (startError !== null) line = startError;
  else if (ended !== null) line = endingLine(ended, name, signOut);
  else if (!started) line = null;
  else if (codeSent)
    line = `Signing you in to ${name}. If nothing happens, Show details has what it says.`;
  else line = signInSteps(started, request.engine, signOut);

  const retry = () => {
    setStarted(null);
    setStartError(null);
    setEnded(null);
    setCodeSent(false);
    setAttempt((value) => value + 1);
  };

  const finish = async () => {
    const id = idRef.current;
    if (id) await signInApi.close(id, true).catch(() => undefined);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "flex max-h-[86vh] max-w-[94vw] flex-col gap-4 p-5",
          details ? "w-180" : "w-120",
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          <div className="flex items-start gap-3" role="status">
            {codeSent && running ? <Spinner label={false} className="mt-0.5" /> : null}
            {line === null ? (
              <SetupState size="row" tool="sign-in" onRetry={retry} />
            ) : (
              <Text size="body" tone={startError === null ? undefined : "danger"} wrap>
                {line}
              </Text>
            )}
          </div>
          {takesCode ? (
            <CodeField
              onSubmit={async (code) => {
                const id = idRef.current;
                if (!id) throw new Error("That sign-in has ended. Close this and try again.");
                await signInApi.code(id, code);
                setCodeSent(true);
              }}
            />
          ) : null}
          <Collapsible open={details} onOpenChange={setDetails}>
            <CollapsibleTrigger asChild>
              <DisclosureButton open={details} size="sm">
                {details ? "Hide details" : "Show details"}
              </DisclosureButton>
            </CollapsibleTrigger>
            <CollapsibleContent forceMount className="grid gap-3 pt-3">
              <CliTerminal
                key={attempt}
                height={300}
                start={start}
                onEnded={setEnded}
                onError={setStartError}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
        <DialogFooter>
          {running ? (
            started?.asks === "menu" ? (
              <Button variant="primary" onClick={() => void finish()}>
                Done
              </Button>
            ) : (
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
            )
          ) : (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodeField({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const id = useId();
  const errorId = `${id}-error`;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Paste the code first.");
      return;
    }
    setSending(true);
    try {
      await onSubmit(trimmed);
      setCode("");
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="grid gap-1.5" onSubmit={(event) => void submit(event)}>
      <Label htmlFor={id}>Code</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={code}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste the code here"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="primary" disabled={sending}>
          Continue
        </Button>
      </div>
      <FieldError id={errorId} message={error} />
    </form>
  );
}

export function CliTerminal({
  start,
  onEnded,
  onError,
  height = 380,
}: {
  start: (id: string, cols: number, rows: number) => Promise<{ command: string }>;
  onEnded: (ok: boolean) => void;
  onError?: (message: string) => void;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const endedRef = useRef(onEnded);
  const errorRef = useRef(onError);
  useEffect(() => {
    endedRef.current = onEnded;
    errorRef.current = onError;
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
          fontSize: uiPx(TERMINAL_FONT_SIZE),
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
        } catch {}
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
        if (disposed) return;
        const message = errorText(reason);
        setError(message);
        errorRef.current?.(message);
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
        <Text size="caption" tone="muted" wrap>
          {command}
        </Text>
      ) : null}
      <Surface
        tone="card"
        edge="hairline"
        radius="lg"
        className="relative shrink-0 overflow-hidden p-2"
        style={{ height }}
      >
        <div ref={hostRef} className="size-full" />
        {!ready && !error ? (
          <div className="absolute inset-2">
            <SetupState tool="terminal" />
          </div>
        ) : null}
      </Surface>
      {error ? (
        <Text size="meta" role="alert" tone="muted" wrap>
          {error}
        </Text>
      ) : null}
    </>
  );
}
