import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import {
  ColorSwatch,
  Field,
  IconButton,
  Input,
  Segment,
  Separator,
  Switch,
  Text,
  useNotice,
} from "@/shared/ui";
import { updateAgent } from "./HireAgent";
import { StudioSide, StudioSideHead } from "./StudioHud";
import { hairs, hashOf, shirts, skins, trousers } from "./studio/look";
import { emptyLook, useStudioLooks, type Accessory, type FigureLook } from "./studioLooks";

const hairStyles: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 0, label: "Short" },
  { value: 1, label: "Bun" },
  { value: 2, label: "Long" },
  { value: 3, label: "Beanie" },
];
const accessories: { value: Accessory; label: string }[] = [
  { value: "none", label: "None" },
  { value: "glasses", label: "Glasses" },
  { value: "headphones", label: "Headphones" },
  { value: "cap", label: "Cap" },
];
/** Some desks come with a plant (`Desk`); its switch starts on there. */
const deskHasPlant = (deskId: string | undefined) => Boolean(deskId && hashOf(deskId) % 3 === 0);
const mugs = ["#e76f51", "#2a9d8f", "#e9c46a", "#f4f1de", "#7768ae", "#3d5a80"];

/** A labelled row of choices: the label over them. */
function ChoiceRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5" role="radiogroup" aria-label={props.label}>
      <Text bare size="caption" tone="muted">
        {props.label}
      </Text>
      {props.children}
    </div>
  );
}

/** A row of colours to pick from; the picked one is ringed. */
function Swatches(props: {
  label: string;
  colors: readonly string[];
  value: string | undefined;
  onPick(color: string): void;
}) {
  return (
    <ChoiceRow label={props.label}>
      <div className="flex flex-wrap gap-1.5">
        {props.colors.map((color) => (
          <ColorSwatch
            key={color}
            radio
            color={color}
            label={color}
            selected={props.value === color}
            onClick={() => props.onPick(color)}
          />
        ))}
      </div>
    </ChoiceRow>
  );
}

/** A few named choices side by side; the picked one is filled. */
function Choices<T extends string | number>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onPick(value: T): void;
}) {
  return (
    <ChoiceRow label={props.label}>
      <div className="flex flex-wrap gap-1">
        {props.options.map((option) => (
          <Segment
            key={String(option.value)}
            type="button"
            look="outline"
            role="radio"
            aria-checked={props.value === option.value}
            onClick={() => props.onPick(option.value)}
          >
            {option.label}
          </Segment>
        ))}
      </div>
    </ChoiceRow>
  );
}

/** A part of the panel under a hairline, with its name. */
function Section(props: { label: string; children: ReactNode }) {
  return (
    <section className="grid" aria-label={props.label}>
      <Separator />
      <div className="grid gap-2.5 pt-3.5">
        <Text as="h4" size="caption" weight="semibold" tone="bright">
          {props.label}
        </Text>
        {props.children}
      </div>
    </section>
  );
}

/**
 * Making an agent its own: its name and role, how it looks in the studio and what is on its desk.
 * Every change shows in the room at once and is kept on this computer: the name and role with the
 * agent, the rest in the studio's own documents (`studioLooks.ts`).
 */
export function CustomizePanel(props: {
  agent: AgentProfile;
  /** The agent's desk, whose own things show until something else is chosen. */
  deskId?: string;
  onClose(): void;
}) {
  const { agent } = props;
  const look = useStudioLooks((state) => state.looks[agent.id]) ?? emptyLook();
  const change = useStudioLooks((state) => state.change);
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const figure = (next: FigureLook) =>
    change(agent.id, (known) => ({ ...known, figure: { ...known.figure, ...next } }));
  const desk = (next: typeof look.desk) =>
    change(agent.id, (known) => ({ ...known, desk: { ...known.desk, ...next } }));
  const keep = (next: { name?: string; role?: string }) => {
    if (next.name !== undefined && (!next.name.trim() || next.name.trim() === agent.name)) {
      setName(agent.name);
      return;
    }
    if (next.role !== undefined && next.role.trim() === agent.role) return;
    void updateAgent(agent, next).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  return (
    <StudioSide className="w-71" aria-label={`Customize ${agent.name}`}>
      <StudioSideHead title="Customize">
        <IconButton label="Done" onClick={props.onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </StudioSideHead>
      <div className="-mx-1 grid min-h-0 gap-4 overflow-y-auto px-1 pb-1">
        <div className="grid gap-3">
          <Field label="Name">
            <Input
              maxLength={80}
              value={name}
              readOnly={agent.system_managed}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => keep({ name })}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
          </Field>
          <Field label="Role">
            <Input
              maxLength={160}
              placeholder="Reviews pull requests"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              onBlur={() => keep({ role })}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
          </Field>
        </div>
        <Section label="Look">
          <Swatches
            label="Skin"
            colors={skins}
            value={look.figure.skin}
            onPick={(skin) => figure({ skin })}
          />
          <Swatches
            label="Hair"
            colors={hairs}
            value={look.figure.hair}
            onPick={(hair) => figure({ hair })}
          />
          <Choices
            label="Hairstyle"
            options={hairStyles}
            value={look.figure.hairStyle ?? -1}
            onPick={(hairStyle) => figure({ hairStyle: hairStyle as 0 | 1 | 2 | 3 })}
          />
          <Swatches
            label="Shirt"
            colors={shirts}
            value={look.figure.shirt}
            onPick={(shirt) => figure({ shirt })}
          />
          <Swatches
            label="Trousers"
            colors={trousers}
            value={look.figure.trousers}
            onPick={(next) => figure({ trousers: next })}
          />
          <Choices
            label="Wears"
            options={accessories}
            value={look.figure.accessory ?? "none"}
            onPick={(accessory) => figure({ accessory })}
          />
        </Section>
        <Section label="Desk">
          {(
            [
              ["plant", "Plant"],
              ["photo", "Photo"],
              ["lamp", "Lamp"],
            ] as const
          ).map(([key, label]) => (
            <Text
              as="label"
              bare
              size="meta"
              tone="default"
              key={key}
              className="flex h-8 items-center justify-between"
            >
              <span>{label}</span>
              <Switch
                checked={look.desk[key] ?? (key === "plant" && deskHasPlant(props.deskId))}
                onCheckedChange={(on) => desk({ [key]: on })}
              />
            </Text>
          ))}
          <Swatches
            label="Mug"
            colors={mugs}
            value={look.desk.mug}
            onPick={(mug) => desk({ mug })}
          />
        </Section>
      </div>
    </StudioSide>
  );
}
