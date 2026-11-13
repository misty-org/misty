// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Installing or updating an engine CLI: the exact plan to confirm, then the installer's output
 * as it streams. The state lives in useCliUpdateFlow; this only draws it.
 *
 * While a run is active the dialog can't be closed: closing would suggest the install stopped
 * when it didn't. A vendor's own installer never runs hidden: it runs in a terminal inside the
 * dialog, as desktop-cc-gui types it into its built-in terminal, where the person sees everything
 * it does and can stop it (Ctrl+C, or Stop, which ends it).
 *
 * `plain` is the first-run version, for someone who has never seen a terminal: the row's Install
 * starts the install at once, the dialog says in one sentence what is happening, and the plan,
 * the output and the installer's terminal wait under Show details. The terminal still runs in
 * the dialog and Stop still ends it; it is only folded away.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { engineName } from "../channels/engines";
import {
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  Skeleton,
  Spinner,
  Text,
} from "@/shared/ui";
import type { CliUpdatePlan } from "./api";
import { CliTerminal } from "./SignInDialog";
import { signInApi } from "./signInApi";
import type { CliUpdateFlow, CliUpdateFlowState } from "./useCliUpdateFlow";

const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

export function CliUpdateDialog({
  engine,
  flow,
  plain = false,
}: {
  engine: string;
  flow: CliUpdateFlow;
  /** First run: one plain sentence, the details folded away, and no second confirm. */
  plain?: boolean;
}) {
  const { state } = flow;
  if (state.status === "idle") return null;
  if (plain) return <PlainInstallDialog engine={engine} flow={flow} />;
  const inTerminal = state.status === "terminal";
  // An installer still running in the terminal ends only through Stop, never a stray click.
  const running = state.status === "running" || (inTerminal && state.terminalOk === null);
  const title =
    state.plan?.action === "update"
      ? `Update ${engineName(engine)}`
      : `Install ${engineName(engine)}`;
  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : flow.close())}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "flex max-h-[86vh] max-w-[94vw] flex-col gap-4 p-5",
          inTerminal ? "w-[720px]" : "w-[580px]",
        )}
      >
        <DialogTitle className="pr-10 text-base">{title}</DialogTitle>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          {state.status === "planning" ? (
            <div className="grid gap-2" aria-label="Preparing the plan">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : null}
          {state.plan ? <PlanSummary plan={state.plan} terminal={inTerminal} /> : null}
          {inTerminal ? (
            <CliTerminal
              height={300}
              start={(id, cols, rows) => signInApi.installInTerminal(engine, id, cols, rows)}
              onEnded={flow.terminalEnded}
            />
          ) : null}
          <LiveLog state={state} />
          <StatusNotice state={state} />
        </div>
        <DialogFooter state={state} flow={flow} />
      </DialogContent>
    </Dialog>
  );
}

/** The plan's pills, anything blocking it, and the exact commands. */
function PlanSummary({ plan, terminal }: { plan: CliUpdatePlan; terminal: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <PlanPill label={plan.action === "update" ? "Update" : "Install"} />
        <PlanPill
          label={
            plan.kind === "npm"
              ? "Through npm"
              : plan.kind === "native"
                ? "Vendor's installer"
                : "Not available"
          }
        />
        <PlanPill label={plan.platform} />
      </div>
      {plan.blockers.map((blocker) => (
        <p key={blocker} className="text-sm text-cream-muted" role="alert">
          {blocker}
        </p>
      ))}
      {plan.terminalCommand ? (
        terminal ? null : (
          <>
            <p className="text-sm text-cream-muted">
              The vendor's installer runs in a terminal here, where you can see its output and stop
              it.
            </p>
            <PlanCommand label="Will run" command={plan.manualCommand} />
          </>
        )
      ) : plan.command.length > 0 ? (
        <PlanCommand label="Will run" command={plan.command.join(" ")} />
      ) : null}
      {plan.manualCommand && !plan.terminalCommand ? (
        <PlanCommand label="To run it yourself" command={plan.manualCommand} />
      ) : null}
    </>
  );
}

/** The installer's output, kept on the newest line while it streams. */
function LiveLog({ state }: { state: CliUpdateFlowState }) {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logs]);
  const showLog =
    !state.plan?.terminalCommand &&
    (state.status === "running" ||
      state.status === "done" ||
      (state.status === "error" && state.plan));
  if (!showLog) return null;
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-cream-muted">Output</p>
      <pre
        ref={logRef}
        className="max-h-56 overflow-y-auto rounded-lg bg-charcoal-card p-2 font-mono text-xs break-all whitespace-pre-wrap text-cream"
      >
        {state.logs.length > 0
          ? state.logs.map((line) => `[${line.stream}] ${line.text}`).join("\n")
          : "Waiting for output"}
      </pre>
    </div>
  );
}

function StatusNotice({ state }: { state: CliUpdateFlowState }) {
  if (state.status === "done") {
    return (
      <p role="status" className="text-sm text-cream">
        Installed
      </p>
    );
  }
  if (state.status === "terminal" && state.terminalOk !== null) {
    return (
      <p role="status" className="text-sm text-cream">
        {state.terminalOk ? "Installed" : "The installer stopped before it finished."}
      </p>
    );
  }
  if (state.status === "error" && state.error) {
    return (
      <p role="alert" className="text-sm text-cream-muted">
        {state.error}
      </p>
    );
  }
  return null;
}

function DialogFooter({ state, flow }: { state: CliUpdateFlowState; flow: CliUpdateFlow }) {
  const footer = "flex justify-end gap-2";
  if (state.status === "running") {
    return (
      <div className={footer}>
        <Button variant="primary" disabled>
          Running
        </Button>
      </div>
    );
  }
  if (state.status === "done") {
    return (
      <div className={footer}>
        <Button variant="primary" autoFocus onClick={flow.close}>
          Close
        </Button>
      </div>
    );
  }
  if (state.status === "terminal") {
    if (state.terminalOk === null) {
      return (
        <div className={footer}>
          <Button onClick={flow.close}>Stop</Button>
        </div>
      );
    }
    return (
      <div className={footer}>
        <Button variant="primary" autoFocus onClick={flow.checkAgain}>
          Done
        </Button>
      </div>
    );
  }
  const plan = state.plan;
  return (
    <div className={footer}>
      <Button onClick={flow.close}>Cancel</Button>
      {state.status === "error" ? (
        <Button
          variant="primary"
          autoFocus
          onClick={() => void (plan ? flow.confirm() : flow.begin())}
        >
          Try again
        </Button>
      ) : plan?.kind === "npm" && !plan.canRun ? (
        // The only thing that stops an npm install is a missing Node.js: its own download page
        // is the way on, and Install works once it is there.
        <Button
          variant="primary"
          autoFocus
          onClick={() => {
            void openUrl(NODE_DOWNLOAD_URL).catch(() => {});
            flow.close();
          }}
        >
          <ExternalLink />
          Get Node.js
        </Button>
      ) : (
        <Button
          variant="primary"
          autoFocus
          disabled={state.status !== "ready" || !plan?.canRun}
          onClick={() => void flow.confirm()}
        >
          Run
        </Button>
      )}
    </div>
  );
}

function PlanPill({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-cream/10 bg-charcoal-hover px-2 py-0.5 text-xs text-cream-muted">
      {label}
    </span>
  );
}

function PlanCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-cream-muted">{label}</p>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          aria-label={`Copy: ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="rounded-lg bg-charcoal-card p-2 font-mono text-xs break-all whitespace-pre-wrap text-cream">
        {command}
      </pre>
    </div>
  );
}

/** After this long, a still-running install says where to look in case it is asking something. */
const SLOW_INSTALL_MS = 60_000;

/** The first-run install: what is happening in a sentence, with the workings under Show details. */
function PlainInstallDialog({ engine, flow }: { engine: string; flow: CliUpdateFlow }) {
  const { state, confirm } = flow;
  const name = engineName(engine);
  const [details, setDetails] = useState(false);
  const [slow, setSlow] = useState(false);
  const inTerminal = state.status === "terminal";
  const running = state.status === "running" || (inTerminal && state.terminalOk === null);
  const needsNode = state.plan?.kind === "npm" && !state.plan.canRun;
  // The row's Install was the person's go-ahead, so a plan that can run starts at once.
  const autoStart = state.status === "ready" && Boolean(state.plan?.canRun);
  useEffect(() => {
    if (autoStart) void confirm();
  }, [autoStart, confirm]);
  useEffect(() => {
    if (!running) return;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_INSTALL_MS);
    return () => window.clearTimeout(timer);
  }, [running]);
  const finished = state.status === "done" || (inTerminal && state.terminalOk === true);
  const stopped = (inTerminal && state.terminalOk === false) || state.status === "error";

  let line: ReactNode;
  if (needsNode) {
    line = `${name} needs Node.js, a free program from nodejs.org. Install it, then press Install again.`;
  } else if (finished) {
    line = `${name} is installed.`;
  } else if (stopped) {
    line = state.error ?? "The install stopped before it finished.";
  } else if (state.plan && !state.plan.canRun) {
    line = state.plan.blockers[0] ?? `Misty can't install ${name} here.`;
  } else {
    line = slow
      ? `Still working. If it seems stuck, Show details may have a question for you.`
      : `Downloading ${name} from its maker and setting it up. This takes a minute or two.`;
  }

  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : flow.close())}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "flex max-h-[86vh] max-w-[94vw] flex-col gap-4 p-5",
          details && inTerminal ? "w-180" : "w-120",
        )}
      >
        <DialogTitle className="pr-10 text-base">{`Install ${name}`}</DialogTitle>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          <div className="flex items-start gap-3" role="status">
            {running || state.status === "planning" || autoStart ? (
              <Spinner className="mt-0.5 shrink-0" />
            ) : finished ? (
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : null}
            <Text size="body" wrap>
              {line}
            </Text>
          </div>
          {state.plan ? (
            <Collapsible open={details} onOpenChange={setDetails}>
              <CollapsibleTrigger asChild>
                <Button variant="quiet" size="sm" className="justify-self-start">
                  <ChevronDown className={cn("transition-transform", details && "rotate-180")} />
                  {details ? "Hide details" : "Show details"}
                </Button>
              </CollapsibleTrigger>
              {/* Mounted while folded, so the installer's terminal keeps running behind it. */}
              <CollapsibleContent forceMount className="grid gap-3 pt-3">
                <PlanSummary plan={state.plan} terminal={inTerminal} />
                {inTerminal ? (
                  <CliTerminal
                    height={260}
                    start={(id, cols, rows) => signInApi.installInTerminal(engine, id, cols, rows)}
                    onEnded={flow.terminalEnded}
                  />
                ) : null}
                <LiveLog state={state} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
        <PlainFooter engine={engine} flow={flow} running={running} needsNode={needsNode} />
      </DialogContent>
    </Dialog>
  );
}

function PlainFooter({
  engine,
  flow,
  running,
  needsNode,
}: {
  engine: string;
  flow: CliUpdateFlow;
  running: boolean;
  needsNode: boolean;
}) {
  const { state } = flow;
  const footer = "flex justify-end gap-2";
  // An npm install can't be stopped halfway, so it offers nothing until it ends.
  if (state.status === "running") return null;
  if (running) {
    return (
      <div className={footer}>
        <Button onClick={flow.close}>Stop</Button>
      </div>
    );
  }
  if (state.status === "done" || state.status === "terminal") {
    return (
      <div className={footer}>
        {state.status === "terminal" && state.terminalOk === false ? (
          <Button onClick={flow.checkAgain}>Close</Button>
        ) : null}
        <Button
          variant="primary"
          autoFocus
          onClick={
            state.status === "terminal" && state.terminalOk === false
              ? () => void flow.begin()
              : flow.checkAgain
          }
        >
          {state.status === "terminal" && state.terminalOk === false ? "Try again" : "Done"}
        </Button>
      </div>
    );
  }
  if (needsNode) {
    return (
      <div className={footer}>
        <Button onClick={flow.close}>Cancel</Button>
        <Button
          variant="primary"
          autoFocus
          onClick={() => {
            void openUrl(NODE_DOWNLOAD_URL).catch(() => {});
            flow.close();
          }}
        >
          <ExternalLink />
          Get Node.js
        </Button>
      </div>
    );
  }
  return (
    <div className={footer}>
      <Button onClick={flow.close}>{state.status === "error" ? "Close" : "Cancel"}</Button>
      {state.status === "error" ? (
        <Button
          variant="primary"
          autoFocus
          onClick={() => void (state.plan ? flow.confirm() : flow.begin())}
          aria-label={`Try installing ${engineName(engine)} again`}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
