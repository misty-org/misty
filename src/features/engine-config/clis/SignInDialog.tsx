// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Signing in to an engine CLI: its own login runs in a terminal in this dialog, the way
 * desktop-cc-gui hands Pi, Oh My Pi and CodeBuddy logins to its built-in terminal, but the
 * terminal waits under Show details and the dialog says in a sentence what to do in the browser.
 * Where the CLI shows a page and waits for its code (Claude Code, Antigravity), the dialog has one
 * field for that code, which native code types into the terminal; where only the CLI's own screen
 * asks (CodeBuddy's `/login`, Qwen Code's `/auth`), the sentence says to answer it under Show
 * details, and Done counts it as finished. Closing the dialog ends the CLI. When it ends, the
 * caller checks the sign-in again.
 */
import type { Terminal } from "@xterm/xterm";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  TERMINAL_FONT_SIZE,
  terminalFontFamily,
  terminalTheme,
} from "@/shared/lib/terminal/appearance";
import { loadXterm } from "@/shared/lib/terminal/xtermLoader";
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  FieldError,
  Input,
  Label,
  Skeleton,
  Spinner,
  Surface,
  Text,
} from "@/shared/ui";
import { engineName } from "../channels/engines";
import { signInChoiceLabel } from "./SignInButton";
import { listenSignIn, signInApi, type SignInRequest, type SignInStarted } from "./signInApi";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SignInDialog({
  request,
  onClose,
}: {
  /** null keeps the dialog closed. */
  request: SignInRequest | null;
  /** After the CLI ended or the person closed the dialog. */
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

/** The page a provider's device sign-in opens, for the sentence that asks for its code. */
const DEVICE_PAGES: Record<string, string> = {
  "github-copilot": "A GitHub page",
  xai: "An xAI page",
  "xai-oauth": "An xAI page",
};

/** The page each engine's direct sign-in opens, where it's always the same one. */
const ENGINE_PAGES: Record<string, string> = {
  gemini: "A Google page opens in your browser. Sign in there with your Google account",
  kimi: "A Kimi page opens in your browser. Sign in there and allow access",
  qoder: "A Qoder page opens in your browser. Sign in there with your Qoder account",
  "qoder-cn": "A Qoder page opens in your browser. Sign in there with your Qoder account",
  grok: "An xAI page opens in your browser. Sign in there with your X or xAI account",
};

/** What the person does while the sign-in runs, in plain words. */
export function signInSteps(
  started: SignInStarted,
  engine: string,
  signOut: boolean,
  provider?: string,
): string {
  const name = engineName(engine);
  if (started.asks === "device-code") {
    const page = DEVICE_PAGES[provider ?? ""] ?? "A sign-in page";
    return (
      `${page} opens in your browser and asks for a code. Open Show details to see the code, ` +
      "enter it on that page, then come back here."
    );
  }
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
  const chosen = signInChoiceLabel(engine, provider);
  if (chosen && (engine === "pi" || engine === "omp")) {
    return `A sign-in page for ${chosen} opens in your browser. Sign in there, then come back here.`;
  }
  return "A sign-in page opens in your browser. Finish there, then come back here.";
}

/** How the sign-in ended, in plain words. */
function endingLine(ok: boolean, name: string, signOut: boolean): string {
  if (signOut) {
    return ok ? `You're signed out of ${name}.` : `${name} stopped before it signed you out.`;
  }
  return ok
    ? `You're signed in to ${name}.`
    : "The sign-in didn't finish. Close this and press Sign in to try again.";
}

function SignInTerminal({ request, onClose }: { request: SignInRequest; onClose: () => void }) {
  // Started once per dialog: the key above remounts it for another engine or provider.
  const requestRef = useRef(request);
  const idRef = useRef<string | null>(null);
  const [started, setStarted] = useState<SignInStarted | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [ended, setEnded] = useState<boolean | null>(null);
  const [details, setDetails] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
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
  else line = signInSteps(started, request.engine, signOut, request.provider);

  // Done on a sign-in answered in the CLI's own screen says the person finished it there.
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
        <DialogTitle className="pr-10 text-base">{title}</DialogTitle>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          <div className="flex items-start gap-3" role="status">
            {codeSent && running ? <Spinner label={false} className="mt-0.5" /> : null}
            {line === null ? (
              // The sentence it stands for wraps to two body lines (22px each).
              <div className="grid min-w-0 flex-1">
                <div className="flex h-5.5 items-center">
                  <Skeleton className="h-4 w-full" />
                </div>
                <div className="flex h-5.5 items-center">
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
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
              <Button variant="quiet" size="sm" className="justify-self-start">
                <ChevronDown className={cn("transition-transform", details && "rotate-180")} />
                {details ? "Hide details" : "Show details"}
              </Button>
            </CollapsibleTrigger>
            {/* Mounted while folded, so the CLI keeps running behind it. */}
            <CollapsibleContent forceMount className="grid gap-3 pt-3">
              <CliTerminal height={300} start={start} onEnded={setEnded} />
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="flex justify-end gap-2">
          {running ? (
            // A CLI whose own screen asks never ends by itself: the person closes it when done.
            started?.asks === "menu" ? (
              <Button variant="primary" onClick={() => void finish()}>
                Done
              </Button>
            ) : (
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )
          ) : (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one field for a code the sign-in page shows. What is typed lives only in this field until
 * it is sent to the CLI, and is cleared once sent; nothing of it is kept or logged.
 */
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
        <Button type="submit" variant="primary" loading={sending}>
          Continue
        </Button>
      </div>
      <FieldError id={errorId} message={error} />
    </form>
  );
}

/**
 * The terminal native code runs for a sign-in: the line that runs, then the program's screen,
 * which the person types into. `start` is called once, as the terminal mounts; unmounting ends
 * the program. `onEnded` gets whether it exited cleanly.
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
        <Text size="caption" tone="muted" wrap>
          {command}
        </Text>
      ) : error ? null : (
        <Skeleton className="h-4 w-1/3" />
      )}
      <Surface
        tone="card"
        edge="hairline"
        radius="lg"
        className="relative shrink-0 overflow-hidden p-2"
        style={{ height }}
      >
        <div ref={hostRef} className="size-full" />
        {!ready && !error ? <Skeleton className="absolute inset-2" /> : null}
      </Surface>
      {error ? (
        <Text role="alert" tone="muted" wrap className="text-sm">
          {error}
        </Text>
      ) : null}
    </>
  );
}
