import { useState } from "react";
import { GraduationCap, RotateCcw, Settings2 } from "lucide-react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  openSettings,
} from "@/features/settings";
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
} from "@/shared/ui";
import { companionAvailable, setCompanionOn, useCompanionOn } from "./companionOn";
import {
  companionSizeDefault,
  companionSizeMax,
  companionSizeMin,
  companionSizeStep,
  normalizeCompanionSize,
} from "./companionSize";
import { companionControl, useCompanionState, type CompanionControl } from "./companionState";
import { useTutorSetup } from "./tutorSetup";

const talkKeys = () => (/Mac/.test(navigator.platform) ? "⌃ ⌥" : "Ctrl + Alt");

/** What Tutor is doing, in a few words under its name. */
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

/**
 * Settings › Tutor. Tutor is the companion at the cursor, on anywhere on the desktop while Misty
 * runs, and switched from here or the menu bar. It runs on the default engine and this computer's
 * own speech. The page leads with Misty herself, what Tutor is doing and its switch, then how it
 * behaves; with no default engine, it says where to pick one.
 */
export function TutorSettings() {
  const on = useCompanionOn();
  const setup = useTutorSetup();
  const { presentation, control } = useCompanionState();
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  if (!companionAvailable())
    return (
      <Section title="Tutor">
        <Row label="Tutor" description="Tutor runs in Misty for macOS and Windows.">
          {null}
        </Row>
      </Section>
    );

  const act = (value: CompanionControl) => {
    setError("");
    void companionControl(value).catch((reason) => setError(String(reason)));
  };
  const size = normalizeCompanionSize(presentation.size);
  const status = tutorStatus({
    ready: setup.ready,
    on,
    phase: presentation.phase,
    talkKeys: talkKeys(),
  });

  return (
    <>
      <Section title="Tutor">
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
      </Section>

      {setup.ready === false ? (
        <Section title="Setup">
          <EmptyState
            inline
            title="Pick a default engine"
            line="Tutor runs on the engine you pick in Settings › Agents."
            action={{
              label: "Pick an engine",
              icon: Settings2,
              onClick: () => openSettings("models"),
            }}
          />
        </Section>
      ) : null}

      {/* Tutor hears and speaks through this computer's own speech; its voice is in Settings ›
          Voice. */}
      <Section title="Voice">
        <Row label="Talk shortcut" description="Hold it anywhere on your desktop.">
          <Text size="control" tone="muted">
            {talkKeys()}
          </Text>
        </Row>
        <Row
          label="Captions while Tutor talks"
          description="Shows what Tutor says at the bottom of the screen."
        >
          <Switch
            aria-label="Captions while Tutor talks"
            checked={presentation.captions === true}
            disabled={!control}
            onCheckedChange={(captions) => act({ kind: "captions", captions })}
          />
        </Row>
      </Section>

      {setup.ready && on ? (
        <Section title="Tour">
          <Row label="Tutor tour" description="Try each thing Tutor does once, out loud.">
            <Button
              icon={GraduationCap}
              disabled={!control}
              onClick={() => act({ kind: "tour", start: true })}
            >
              Take the tour
            </Button>
          </Row>
        </Section>
      ) : null}

      <Section title="Behavior">
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
      </Section>
    </>
  );
}
