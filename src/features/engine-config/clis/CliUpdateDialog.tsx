// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Installing or updating an engine CLI: what will run, then a plain sentence while it runs, with
 * the plan and the installer's output under Show details. The state lives in useCliUpdateFlow;
 * this only draws it.
 *
 * Every install runs inside the app: nobody types into a terminal. A missing engine goes into
 * Misty's folder, and an npm engine on a computer without Node.js gets Misty's own first ("Getting
 * a helper this AI needs first."). While a run is active the dialog can't be closed: closing would
 * suggest the install stopped when it didn't.
 *
 * `plain` is the first-run version, for someone who has never seen a terminal: the row's Install
 * starts the install at once, with no plan to confirm first.
 *
 * An engine whose installer needs Git on a Mac without Apple's developer tools (Hermes Agent) asks
 * for those first, with one button that opens Apple's installer, instead of the installer opening
 * it by surprise. Once it is open, Continue plans the install again.
 */
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { engineName } from "../channels/engines";
import {
  Badge,
  Button,
  cn,
  CodeBlock,
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
import type { CliUpdateFlow, CliUpdateFlowState } from "./useCliUpdateFlow";

/** After this long, a still-running install says where its output is. */
const SLOW_INSTALL_MS = 60_000;

export function CliUpdateDialog({
  engine,
  flow,
  plain = false,
}: {
  engine: string;
  flow: CliUpdateFlow;
  /** First run: no plan to confirm, the install starts at once. */
  plain?: boolean;
}) {
  const { state, confirm } = flow;
  const running = state.status === "running";
  // In the first-run dialog the row's Install was the go-ahead, so a plan that can run starts.
  const developerTools = Boolean(state.plan?.needsDeveloperTools);
  const autoStart =
    plain && state.status === "ready" && Boolean(state.plan?.canRun) && !developerTools;
  useEffect(() => {
    if (autoStart) void confirm();
  }, [autoStart, confirm]);
  if (state.status === "idle") return null;
  const name = engineName(engine);
  const title = state.plan?.action === "update" ? `Update ${name}` : `Install ${name}`;
  // Before a run, the full dialog shows the plan to confirm; after it starts, its sentence.
  const confirming =
    !plain && !developerTools && (state.status === "ready" || state.status === "planning");
  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : flow.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[86vh] w-120 max-w-[94vw] flex-col gap-4 p-5"
      >
        <DialogTitle className="pr-10 text-base">{title}</DialogTitle>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          {/* While the plan is asked for, the full dialog holds the plan's own shape: the badges,
              the "Will run" label and the steps. Nothing runs yet, so nothing says it does. */}
          {state.status === "planning" && !plain ? (
            <PlanSummarySkeleton />
          ) : confirming && state.plan ? (
            <PlanSummary plan={state.plan} />
          ) : (
            <RunStatus engine={engine} state={state} starting={autoStart} />
          )}
          {!confirming && state.plan ? <RunDetails state={state} /> : null}
        </div>
        <DialogFooter flow={flow} plain={plain} />
      </DialogContent>
    </Dialog>
  );
}

/** One sentence on where the run is, with a spinner while it works. */
function RunStatus({
  engine,
  state,
  starting,
}: {
  engine: string;
  state: CliUpdateFlowState;
  starting: boolean;
}) {
  const name = engineName(engine);
  const running = state.status === "running";
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!running) return;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_INSTALL_MS);
    return () => window.clearTimeout(timer);
  }, [running, state.step]);
  const updating = state.plan?.action === "update";
  const developerTools = Boolean(state.plan?.needsDeveloperTools);

  let line: ReactNode;
  if (state.status === "planning") {
    line = updating ? `Getting ready to update ${name}.` : `Getting ready to install ${name}.`;
  } else if (developerTools && state.status === "done") {
    line = `Apple's installer is open. When it finishes, continue to install ${name}.`;
  } else if (developerTools && running) {
    line = "Opening Apple's installer.";
  } else if (developerTools && state.status === "ready" && state.plan?.canRun) {
    line = "This needs Apple's developer tools first.";
  } else if (state.status === "done") {
    line = updating ? `${name} is up to date.` : `${name} is installed.`;
  } else if (state.status === "error") {
    line = state.error ?? "The install stopped before it finished.";
  } else if (state.plan && !state.plan.canRun) {
    line = state.plan.blockers[0] ?? `Misty can't install ${name} here.`;
  } else if (running && state.step === "helper") {
    line = "Getting a helper this AI needs first.";
  } else if (slow) {
    line = "Still working. Show details has its output.";
  } else if (updating) {
    line = `Updating ${name}. This takes a minute or two.`;
  } else {
    line = `Downloading ${name} from its maker and setting it up. This takes a minute or two.`;
  }
  const busy = running || state.status === "planning" || starting;
  return (
    <div className="flex items-start gap-3" role={state.status === "error" ? "alert" : "status"}>
      {busy ? (
        <Spinner className="mt-0.5 shrink-0" />
      ) : state.status === "done" ? (
        <Check aria-hidden="true" className="mt-0.5 shrink-0" />
      ) : null}
      <Text size="body" wrap>
        {line}
      </Text>
    </div>
  );
}

/** The plan and the output, folded under Show details. */
function RunDetails({ state }: { state: CliUpdateFlowState }) {
  const [open, setOpen] = useState(false);
  if (!state.plan) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="quiet" size="sm" className="justify-self-start">
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          {open ? "Hide details" : "Show details"}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pt-3">
        <PlanSummary plan={state.plan} />
        <LiveLog state={state} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** How the plan installs, anything blocking it, and what runs, step by step. */
function PlanSummary({ plan }: { plan: CliUpdatePlan }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline">{plan.action === "update" ? "Update" : "Install"}</Badge>
        <Badge variant="outline">
          {plan.kind === "npm"
            ? "Through npm"
            : plan.kind === "native"
              ? "From its maker"
              : "Not available"}
        </Badge>
        <Badge variant="outline">{plan.platform}</Badge>
      </div>
      {plan.blockers.map((blocker) => (
        <Text key={blocker} size="control" tone="muted" wrap role="alert">
          {blocker}
        </Text>
      ))}
      {plan.steps.length > 0 ? (
        <div className="grid gap-1">
          <Text size="control" tone="muted" weight="medium">
            Will run
          </Text>
          <CodeBlock code={plan.steps.join("\n")} wrap copyLabel="Copy the steps" />
        </div>
      ) : null}
    </div>
  );
}

/** PlanSummary's shape while the plan is asked for: the badges, "Will run" and the steps. */
function PlanSummarySkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="Preparing the plan">
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-1">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-13 w-full" />
      </div>
    </div>
  );
}

/** The installer's output, kept on the newest line while it streams. */
function LiveLog({ state }: { state: CliUpdateFlowState }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const pre = box?.querySelector("pre");
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [box, state.logs]);
  if (state.status === "ready" || state.status === "planning") return null;
  return (
    <div className="grid gap-1" ref={setBox}>
      <Text size="control" tone="muted" weight="medium">
        Output
      </Text>
      <CodeBlock
        className="[&>pre]:max-h-56 [&>pre]:overflow-y-auto"
        code={
          state.logs.length > 0
            ? state.logs.map((line) => line.text).join("\n")
            : "Waiting for output"
        }
        wrap
        copyLabel="Copy the output"
      />
    </div>
  );
}

function DialogFooter({ flow, plain }: { flow: CliUpdateFlow; plain: boolean }) {
  const { state } = flow;
  const footer = "flex justify-end gap-2";
  // A run can't be stopped halfway, so it offers nothing until it ends.
  if (state.status === "running") return null;
  const plan = state.plan;
  if (plan?.needsDeveloperTools && plan.canRun && state.status !== "error") {
    const done = state.status === "done";
    return (
      <div className={footer}>
        <Button
          variant="primary"
          autoFocus
          disabled={!done && state.status !== "ready"}
          onClick={() => void (done ? flow.begin() : flow.confirm())}
        >
          {done ? "Continue" : "Install developer tools"}
        </Button>
      </div>
    );
  }
  if (state.status === "done") {
    return (
      <div className={footer}>
        <Button variant="primary" autoFocus onClick={flow.checkAgain}>
          Done
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
          onClick={() => void (plan ? flow.confirm() : flow.begin())}
        >
          Try again
        </Button>
      ) : !plain ? (
        <Button
          variant="primary"
          autoFocus
          disabled={state.status !== "ready" || !plan?.canRun}
          onClick={() => void flow.confirm()}
        >
          {plan?.action === "update" ? "Update" : "Install"}
        </Button>
      ) : null}
    </div>
  );
}
