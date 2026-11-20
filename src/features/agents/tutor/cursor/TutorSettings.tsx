import { useMemo, useState } from "react";
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
  ListRow,
  Slider,
  Switch,
  Text,
  useNotice,
  type CompanionTint,
} from "@misty/ui";
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
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { tutorConversationOf, tutorTurns } from "./tutorConversation";
import { openAgentThread } from "./tutorHandoff";
import { forgetTutorStyle, useTutorStyle } from "./tutorStyle";

/** How Tutor was asked to answer, with the way to go back; shown only once there is some. */
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

/**
 * What was asked of Tutor in the last day, newest first. A turn whose work went to an agent
 * opens that agent's chat; Tutor keeps nothing older.
 */
function TutorRecent() {
  const conversations = useMistyStore((state) => state.conversations);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const turns = useMemo(() => tutorTurns(tutorConversationOf(conversations)), [conversations]);
  if (!turns.length) return null;
  return (
    <Section title="Recent">
      <ul>
        {turns.map((turn) => {
          const handoff = turn.handoff;
          const agent = handoff && agents.find((item) => item.id === handoff.agentId);
          return (
            <li key={turn.id}>
              <ListRow
                label={turn.asked}
                description={
                  agent ? `Asked ${agent.name}` : turn.answered.split("\n")[0] || undefined
                }
                state={{ kind: "time", at: turn.createdAt }}
                onOpen={
                  handoff && agent
                    ? () => openAgentThread(handoff.agentId, handoff.conversationId)
                    : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

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

      <TutorRecent />

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
        <TutorStyleRow onError={setError} />
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
