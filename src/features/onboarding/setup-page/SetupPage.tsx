import { ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import { useSetupStore, WelcomeNav } from "@/features/account";
import {
  agentAccountId,
  EnginesStep,
  usePersonalAgentsStore,
  type EngineSetupState,
} from "@/features/agents";
import type { EngineId } from "@/features/engine-config/channels";
import { Button, StepPage } from "@/shared/ui";
import { AppsStep } from "./AppsStep";
import { HowMistyWorksStep } from "./HowMistyWorksStep";

type Step = "how" | "engines" | "apps";

const steps: { id: Step; title: string }[] = [
  { id: "how", title: "How Misty works" },
  { id: "engines", title: "Pick an AI to start with" },
  { id: "apps", title: "Which apps should agents use?" },
];

/**
 * First-run setup, after the first sign-in and from Help › Run setup again: how Misty works, then
 * the person's own AI, installed and signed in without a terminal command to type, then the apps
 * agents may use. The last two can be left for later. It ends on the page that sent the person
 * here, or on Agents.
 *
 * Finishing makes an agent for each engine now installed (as listing the agents always does) and
 * starts new chats with the first engine that became ready here.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [step, setStep] = useState<Step>("how");
  const [finishing, setFinishing] = useState(false);
  // The engines that are ready, in the order they became so.
  const [ready, setReady] = useState<EngineId[]>([]);
  const onState = useCallback((engine: EngineId, state: EngineSetupState) => {
    setReady((current) => {
      const has = current.includes(engine);
      if (state === "ready" && !has) return [...current, engine];
      if (state !== "ready" && has) return current.filter((id) => id !== engine);
      return current;
    });
  }, []);
  const index = steps.findIndex((item) => item.id === step);
  const current = steps[index]!;

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const setup = useSetupStore.getState();
    if (!setup.welcomed) setup.askTabSide();
    setup.finishWelcome();
    const agents = usePersonalAgentsStore.getState();
    await agents.load(agentAccountId()).catch(() => undefined);
    const made = usePersonalAgentsStore.getState().agents;
    const starter = ready
      .map((engine) => made.find((agent) => agent.engine === engine && agent.enabled))
      .find(Boolean);
    if (starter) usePersonalAgentsStore.getState().select("global", starter.id);
    navigate(from ?? routes.agents, { replace: true });
  };

  return (
    <StepPage
      nav={<WelcomeNav />}
      label="Setup steps"
      steps={steps.length}
      current={index}
      onBack={index > 0 ? () => setStep(steps[index - 1]!.id) : undefined}
      title={current.title}
      actions={
        step === "how" ? (
          <Button variant="primary" onClick={() => setStep("engines")}>
            Continue
            <ArrowRight />
          </Button>
        ) : step === "engines" ? (
          <>
            {ready.length === 0 ? (
              <Button variant="quiet" onClick={() => setStep("apps")}>
                Skip for now
              </Button>
            ) : null}
            <Button variant="primary" disabled={ready.length === 0} onClick={() => setStep("apps")}>
              Continue
              <ArrowRight />
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={finishing} onClick={() => void finish()}>
            Start using Misty
            <ArrowRight />
          </Button>
        )
      }
    >
      {step === "how" ? <HowMistyWorksStep /> : null}
      {/* The engines step mounts from the start, so its checks run while the person reads, and
            going back never probes the engines again. */}
      <div hidden={step !== "engines"}>
        <EnginesStep onState={onState} />
      </div>
      {step === "apps" ? <AppsStep /> : null}
    </StepPage>
  );
}
