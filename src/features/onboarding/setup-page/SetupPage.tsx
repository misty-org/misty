import { ArrowRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import { useSetupStore, WelcomeNav } from "@/features/account";
import {
  agentAccountId,
  canBeDefault,
  EnginesStep,
  setDefaultEngine,
  useEnginesList,
  usePersonalAgentsStore,
  type EngineSetupState,
} from "@/features/agents";
import type { EngineId } from "@/features/engine-config/channels";
import { useSettingsStore } from "@/features/settings";
import { ensureSpeech, voiceSettings } from "@/features/voice";
import { Button, StepPage } from "@misty/ui";
import { AppsStep } from "./AppsStep";
import { HowMistyWorksStep } from "./HowMistyWorksStep";
import { VoiceStep } from "./VoiceStep";

type Step = "how" | "engines" | "voice" | "apps";

const steps: { id: Step; title: string }[] = [
  { id: "how", title: "How Misty works" },
  { id: "engines", title: "Pick your default engine" },
  { id: "voice", title: "Which language do you speak?" },
  { id: "apps", title: "Which apps should agents use?" },
];

export function SetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const engineOnly = Boolean((location.state as { engineOnly?: boolean } | null)?.engineOnly);
  const [step, setStep] = useState<Step>(engineOnly ? "engines" : "how");
  const [finishing, setFinishing] = useState(false);
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
  const engines = useEnginesList();
  const unfit = useCallback(
    (engine: EngineId) => {
      const info = engines.data?.find((item) => item.id === engine);
      return Boolean(info) && !canBeDefault({ ...info!, installed: true });
    },
    [engines.data],
  );
  const capable = ready.filter((engine) => !unfit(engine));
  const [picked, setPicked] = useState<EngineId>();
  const chosen = picked && capable.includes(picked) ? picked : capable[0];

  const [language, setLanguage] = useState(
    () => voiceSettings(useSettingsStore.getState().settings?.document).language,
  );
  const saveSpeech = () => {
    useSettingsStore.getState().updateSetting("voice", "language", language);
    void ensureSpeech();
    setStep("apps");
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const setup = useSetupStore.getState();
    if (!setup.welcomed) setup.askTabSide();
    setup.finishWelcome();
    const agents = usePersonalAgentsStore.getState();
    await agents.load(agentAccountId()).catch(() => undefined);
    const made = usePersonalAgentsStore.getState().agents;
    if (chosen) await setDefaultEngine(chosen).catch(() => undefined);
    const starter = [chosen, ...ready]
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
            <Button
              variant="primary"
              disabled={!chosen}
              onClick={() => (engineOnly ? void finish() : setStep("voice"))}
            >
              Continue
              <ArrowRight />
            </Button>
          </>
        ) : step === "voice" ? (
          <Button variant="primary" onClick={saveSpeech}>
            Continue
            <ArrowRight />
          </Button>
        ) : (
          <Button variant="primary" disabled={finishing} onClick={() => void finish()}>
            Start using Misty
            <ArrowRight />
          </Button>
        )
      }
    >
      {step === "how" ? <HowMistyWorksStep /> : null}
      <div hidden={step !== "engines"}>
        <EnginesStep onState={onState} chosen={chosen} onChoose={setPicked} unfit={unfit} />
      </div>
      {step === "voice" ? (
        <VoiceStep language={language} onLanguage={setLanguage} />
      ) : null}
      {step === "apps" ? <AppsStep /> : null}
    </StepPage>
  );
}
