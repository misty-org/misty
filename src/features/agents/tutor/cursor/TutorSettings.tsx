import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { DesktopSettingsRow as Row, DesktopSettingsSection as Section } from "@/features/settings";
import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp";
import { IconButton, Slider, Switch, Text, useNotice } from "@/shared/ui";
import { ModelTextRow, useModelSetting } from "../../models/ModelChoiceRows";
import { ModelKeyRow } from "../../models/ModelKeyRow";
import { useSavedModelKeys } from "../../models/modelKeys";
import { providerById, qualifiedModel } from "../../models/modelProviders";
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

const unshown = "It can’t be shown again once saved.";
const talkKeys = () => (/Mac/.test(navigator.platform) ? "⌃ ⌥" : "Ctrl + Alt");

/** What Tutor is doing, in a few words under its name. */
export function tutorStatus(input: {
  ready: boolean | undefined;
  on: boolean | undefined;
  phase: string;
  talkKeys: string;
}): string {
  if (input.ready === undefined || input.on === undefined) return "";
  if (!input.ready) return "Needs setup: choose a model with a key below.";
  if (!input.on) return "Off. Turn it on here or from the menu bar.";
  if (input.phase === "listening") return "Listening";
  if (input.phase === "responding") return "Talking";
  return `Ready. Hold ${input.talkKeys} anywhere to talk.`;
}

/**
 * Settings › Tutor. Tutor is the companion at the cursor, on anywhere on the desktop while Misty
 * runs, and switched from here or the menu bar. The page leads with Misty herself, what Tutor is
 * doing and its switch; then its one required step (a model with a key), the optional voice keys,
 * and how it behaves. Keys stay in this computer's keychain.
 */
export function TutorSettings() {
  const on = useCompanionOn();
  const setup = useTutorSetup();
  const keys = useSavedModelKeys();
  const provider = useModelSetting("models.provider");
  const main = useModelSetting("models.agent_model");
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
  const keyProvider = providerById(setup.provider);
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

      <Section
        title="Setup"
        description="Tutor needs one model with a key. Keys stay in this computer’s keychain and go only to their provider."
      >
        <ModelTextRow
          id="models.fast_model"
          label="Tutor model"
          description="Answers you live and reads your screen. Uses the main model when empty."
          placeholder={main.value || "provider/model"}
          normalize={(value) => qualifiedModel(value, provider.value)}
        />
        {keyProvider && !keyProvider.keyOptional ? (
          <ModelKeyRow
            label={`${keyProvider.label} key`}
            description={
              keyProvider.keyPage
                ? `Paste a key from ${keyProvider.keyPage.replace(/^https:\/\//, "")}. ${unshown}`
                : `Paste your ${keyProvider.label} key. ${unshown}`
            }
            providerId={keyProvider.id}
            keys={keys}
          />
        ) : null}
      </Section>

      <Section title="Voice" description="Optional. Without these, you type to Tutor.">
        <ModelKeyRow
          label="Soniox key"
          description={`Lets Tutor hear you, so you can talk instead of type. ${unshown}`}
          providerId="soniox"
          keys={keys}
        />
        <ModelKeyRow
          label="ElevenLabs key"
          description={`Lets Tutor talk back. ${unshown}`}
          providerId="elevenlabs"
          keys={keys}
        />
        <Row label="Talk shortcut" description="Hold it anywhere on your desktop.">
          <Text size="control" tone="muted">
            {talkKeys()}
          </Text>
        </Row>
      </Section>

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
