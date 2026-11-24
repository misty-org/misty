// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { engineName } from "../channels/engines";
import {
  Badge,
  Button,
  CodeBlock,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DisclosureButton,
  PaneLoading,
  Spinner,
  Text,
  DialogFooter,
} from "@misty/ui";
import type { CliUpdatePlan } from "./api";
import type { CliUpdateFlow, CliUpdateFlowState } from "./use_cli_update_flow";

const SLOW_INSTALL_MS = 60_000;

export function CliUpdateDialog({
  engine,
  flow,
  plain = false,
}: {
  engine: string;
  flow: CliUpdateFlow;
  plain?: boolean;
}) {
  const { state, confirm } = flow;
  const running = state.status === "running";
  const developerTools = Boolean(state.plan?.needsDeveloperTools);
  const autoStart =
    plain && state.status === "ready" && Boolean(state.plan?.canRun) && !developerTools;
  useEffect(() => {
    if (autoStart) void confirm();
  }, [autoStart, confirm]);
  if (state.status === "idle") return null;
  const name = engineName(engine);
  const title = state.plan?.action === "update" ? `Update ${name}` : `Install ${name}`;
  const confirming =
    !plain && !developerTools && (state.status === "ready" || state.status === "planning");
  return (
    <Dialog open onOpenChange={(open) => (open || running ? undefined : flow.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[86vh] w-120 max-w-[94vw] flex-col gap-4 p-5"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          {state.status === "planning" && !plain ? (
            <PlanSummarySkeleton />
          ) : confirming && state.plan ? (
            <PlanSummary plan={state.plan} />
          ) : (
            <RunStatus engine={engine} state={state} starting={autoStart} />
          )}
          {!confirming && state.plan ? <RunDetails state={state} /> : null}
        </div>
        <UpdateFooter flow={flow} plain={plain} />
      </DialogContent>
    </Dialog>
  );
}

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

function RunDetails({ state }: { state: CliUpdateFlowState }) {
  const [open, setOpen] = useState(false);
  if (!state.plan) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <DisclosureButton open={open} size="sm">
          {open ? "Hide details" : "Show details"}
        </DisclosureButton>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pt-3">
        <PlanSummary plan={state.plan} />
        <LiveLog state={state} />
      </CollapsibleContent>
    </Collapsible>
  );
}

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

function PlanSummarySkeleton() {
  return <PaneLoading label="Preparing the plan" inline />;
}

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

function UpdateFooter({ flow, plain }: { flow: CliUpdateFlow; plain: boolean }) {
  const { state } = flow;
  if (state.status === "running") return null;
  const plan = state.plan;
  if (plan?.needsDeveloperTools && plan.canRun && state.status !== "error") {
    const done = state.status === "done";
    return (
      <DialogFooter>
        <Button
          variant="primary"
          autoFocus
          disabled={!done && state.status !== "ready"}
          onClick={() => void (done ? flow.begin() : flow.confirm())}
        >
          {done ? "Continue" : "Install developer tools"}
        </Button>
      </DialogFooter>
    );
  }
  if (state.status === "done") {
    return (
      <DialogFooter>
        <Button variant="primary" autoFocus onClick={flow.checkAgain}>
          Done
        </Button>
      </DialogFooter>
    );
  }
  return (
    <DialogFooter>
      <Button variant="quiet" onClick={flow.close}>
        {state.status === "error" ? "Close" : "Cancel"}
      </Button>
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
    </DialogFooter>
  );
}
