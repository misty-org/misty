import { ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import { useSetupStore, WelcomeNav } from "@/features/account";
import {
  agentAccountId,
  EnginesStep,
  usePersonalAgentsStore,
  type EngineSetupState,
} from "@/features/agents";
import type { EngineId } from "@/features/engine-config/channels";
import { BackButton, Button, cn } from "@/shared/ui";
import { AppsStep } from "./AppsStep";
import "../welcome/welcome.css";

type Step = "engines" | "apps";

const steps: { id: Step; title: string }[] = [
  { id: "engines", title: "Which AI do you use?" },
  { id: "apps", title: "Which apps should agents use?" },
];

/**
 * First-run setup, after the welcome and from Help › Run setup again: the person's own AI,
 * installed and signed in without a terminal command to type, then the apps agents may use. Both
 * steps can be left for later; nothing here needs an account.
 *
 * Finishing makes an agent for each engine now installed (as listing the agents always does) and
 * starts new chats with the first engine that became ready here.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("engines");
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
    navigate(routes.agents, { replace: true });
  };

  return (
    <div className="relative grid h-full min-h-0 overflow-y-auto bg-window-chrome px-6 pb-10 pt-24">
      <WelcomeNav />
      <div className="misty-page-in mx-auto flex w-full max-w-[560px] flex-col gap-6 self-start">
        <div className="flex items-center gap-3">
          {index > 0 ? <BackButton onClick={() => setStep(steps[index - 1]!.id)} /> : null}
          <ol aria-label="Setup steps" className="flex flex-1 items-center gap-1.5">
            {steps.map((item, position) => (
              <li
                key={item.id}
                aria-current={item.id === step ? "step" : undefined}
                aria-label={`Step ${position + 1} of ${steps.length}`}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  position <= index ? "bg-cream-bright" : "bg-charcoal-active",
                )}
              />
            ))}
          </ol>
        </div>
        <h1
          key={current.id}
          className="misty-page-in text-3xl font-medium leading-tight tracking-[-0.025em] text-cream-bright"
        >
          {current.title}
        </h1>
        {/* Both steps stay mounted, so going back never probes the engines again. */}
        <div hidden={step !== "engines"}>
          <EnginesStep onState={onState} />
        </div>
        {step === "apps" ? <AppsStep /> : null}
        <div className="flex items-center justify-end gap-2 pt-2">
          {step === "engines" ? (
            <>
              {ready.length === 0 ? (
                <Button variant="ghost" onClick={() => setStep("apps")}>
                  Skip for now
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={ready.length === 0}
                onClick={() => setStep("apps")}
              >
                Continue
                <ArrowRight />
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={finishing} onClick={() => void finish()}>
              Start using Misty
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
