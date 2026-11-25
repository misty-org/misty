import { useState } from "react";
import { GraduationCap, RotateCcw, Settings2 } from "lucide-react";
import { DesktopSettingsRow as Row, openSettings } from "@/features/settings";
import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp";
import {
  Button,
  ColorSwatch,
  companionTints,
  EmptyState,
  IconButton,
  Slider,
  Switch,
  Text,
  useNotice,
  type CompanionTint,
} from "@misty/ui";
import { companionAvailable, setCompanionOn, useCompanionOn } from "./companion_on";
import {
  companionSizeDefault,
  companionSizeMax,
  companionSizeMin,
  companionSizeStep,
  normalizeCompanionSize,
} from "./companion_size";
import { companionControl, useCompanionState, type CompanionControl } from "./companion_state";
import { useTutorSetup } from "./tutor_setup";
import { forgetTutorStyle, useTutorStyle } from "./tutor_style";

function TutorStyleRow({ onError }: { onError(error: string): void }) {
  const style = useTutorStyle();
  if (!style.length) return null;
  return (
    <Row label="How Tutor answers" description={style.join(". ")}>
      <Button
        variant="quiet"
        onClick={() => void forgetTutorStyle().catch((reason) => onError(String(reason)))}
      >
        Forget
      </Button>
    </Row>
  );
}

const talkKeys = () => (/Mac/.test(navigator.platform) ? "⌃ ⌥" : "Ctrl + Alt");

export function tutorStatus(input: {
  ready: boolean | undefined;
  on: boolean | undefined;
  phase: string;
  talkKeys: string;
}): string {
  if (input.ready === undefined || input.on === undefined) return "";
  if (!input.ready) return "Needs a default engine.";
  if (!input.on) return "Off. Turn it on here or from the menu bar.";
  if (input.phase === "listening") return "Listening";
  if (input.phase === "responding") return "Talking";
  return `Ready. Hold ${input.talkKeys} anywhere to talk.`;
}

function useTutorErrors() {
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  return (value: string) => setError(value);
}

function useTutorControl() {
  const { presentation, control } = useCompanionState();
  const setError = useTutorErrors();
  const act = (value: CompanionControl) => {
    setError("");
    void companionControl(value).catch((reason) => setError(String(reason)));
  };
  return { presentation, control, act, setError };
}

export function TutorSettings() {
  const on = useCompanionOn();
  const setup = useTutorSetup();
  const { presentation } = useCompanionState();
  const setError = useTutorErrors();
  if (!companionAvailable())
    return (
      <Row label="Tutor" description="Tutor runs in Misty for macOS and Windows.">
        {null}
      </Row>
    );
  const status = tutorStatus({
    ready: setup.ready,
    on,
    phase: presentation.phase,
    talkKeys: talkKeys(),
  });
  return (
    <>
      <Row
        label="Tutor"
        description={status}
        leading={
          <img
            src={sprite}
            alt=""
            draggable={false}
            className={`size-14 shrink-0 object-contain ${on && setup.ready ? "" : "opacity-50"}`}
          />
        }
      >
        {setup.ready ? (
          <Switch
            aria-label="Tutor"
            checked={on === true}
            disabled={on === undefined}
            onCheckedChange={(next) =>
              void setCompanionOn(next).catch((reason: unknown) => setError(String(reason)))
            }
          />
        ) : null}
      </Row>
      {setup.ready === false ? (
        <EmptyState
          inline
          title="Pick a default engine"
          line="Tutor runs on the engine you pick in Settings › Engines."
          action={{
            label: "Pick an engine",
            icon: Settings2,
            onClick: () => openSettings("models"),
          }}
        />
      ) : null}
      <TutorStyleRow onError={setError} />
    </>
  );
}

export function TutorTalkingSection() {
  const { presentation, control, act } = useTutorControl();
  if (!companionAvailable()) return null;
  return (
    <>
      <Row label="Talk shortcut">
        <Text size="control" tone="muted">
          {talkKeys()}
        </Text>
      </Row>
      <Row label="Captions while Tutor talks">
        <Switch
          aria-label="Captions while Tutor talks"
          checked={presentation.captions === true}
          disabled={!control}
          onCheckedChange={(captions) => act({ kind: "captions", captions })}
        />
      </Row>
    </>
  );
}

export function TutorTourSection() {
  const on = useCompanionOn();
  const setup = useTutorSetup();
  const { control, act } = useTutorControl();
  if (!companionAvailable() || !setup.ready || !on) return null;
  return (
    <Row label="Tutor tour">
      <Button
        icon={GraduationCap}
        disabled={!control}
        onClick={() => act({ kind: "tour", start: true })}
      >
        Take the tour
      </Button>
    </Row>
  );
}

export function TutorBehaviorSection() {
  const { presentation, control, act } = useTutorControl();
  if (!companionAvailable()) return null;
  const size = normalizeCompanionSize(presentation.size);
  return (
    <>
      <Row
        label="Show Misty at the cursor"
        description="Misty rests beside your pointer. Off, Tutor shows only while you use it."
      >
        <Switch
          aria-label="Show Misty at the cursor"
          checked={presentation.sprite !== false}
          disabled={!control}
          onCheckedChange={(sprite) => act({ kind: "sprite", sprite })}
        />
      </Row>
      <Row
        label="Teach mode"
        description="Shows one step at a time and checks your work, instead of doing it for you."
      >
        <Switch
          aria-label="Teach mode"
          checked={presentation.teach === true}
          disabled={!control}
          onCheckedChange={(teach) => act({ kind: "teach", teach })}
        />
      </Row>
      <Row label="Ask before taking control">
        <Switch
          aria-label="Ask before taking control"
          checked={presentation.ask === true}
          disabled={!control}
          onCheckedChange={(ask) => act({ kind: "ask", ask })}
        />
      </Row>
      <Row label="Color">
        <div role="radiogroup" aria-label="Tutor color" className="flex items-center gap-2">
          {(Object.keys(companionTints) as CompanionTint[]).map((tint) => (
            <ColorSwatch
              key={tint}
              radio
              label={tint[0]!.toUpperCase() + tint.slice(1)}
              color={companionTints[tint]}
              selected={(presentation.tint ?? "white") === tint}
              disabled={!control}
              onClick={() => act({ kind: "tint", tint })}
            />
          ))}
        </div>
      </Row>
      <Row label="Size" description={`${size}%`}>
        <Slider
          aria-label="Companion size"
          aria-valuetext={`${size}%`}
          className="w-40"
          min={companionSizeMin}
          max={companionSizeMax}
          step={companionSizeStep}
          value={[size]}
          disabled={!control}
          onValueChange={([next]) => act({ kind: "size", size: next })}
        />
        <IconButton
          label="Reset size"
          disabled={!control || size === companionSizeDefault}
          onClick={() => act({ kind: "size", size: companionSizeDefault })}
        >
          <RotateCcw />
        </IconButton>
      </Row>
    </>
  );
}
