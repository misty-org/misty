import {
  ClipboardList,
  Cpu,
  Gauge,
  Globe,
  GraduationCap,
  Hammer,
  Shield,
  ShieldCheck,
  ShieldOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  type ActionBarItem,
  type ActionBarMode,
} from "@/shared/ui";
import { invoke } from "@/native/invoke";
import { captureAttachmentFromDataUrl } from "../../../runs/invocations/captureAttachment";
import { CodexFastItem } from "../../view/engine/CodexFastItem";
import {
  permissionModeLabel,
  permissionModes,
  setPermissionMode,
} from "../../../plans/permissionMode";
import { useCollaborationStore } from "../../../plans/store";
import type { ConversationMode, PermissionMode } from "../../../plans/planTypes";
import { EngineMark, hasEngineMark } from "@/features/engine-config/EngineMark";
import { listEngineModels, mistyEngine, type EngineModel } from "../../../engines/enginesApi";
import { useComposerChoices, type ComposerChoices } from "./composerChoices";
import { effortLabel, engineOptions } from "./engineOptions";

/** Captures part of the screen with the system's own picker and attaches it. */
export async function captureRegionFile(): Promise<File | null> {
  const shot = await invoke<{ dataUrl: string; width: number; height: number } | null>(
    "misty_capture_region",
  );
  if (!shot) return null;
  const capture = await captureAttachmentFromDataUrl(shot.dataUrl, shot.width, shot.height);
  const [head, data] = capture.dataUrl.split(",", 2);
  const type = /^data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(window.atob(data), (character) => character.charCodeAt(0));
  return new File([bytes], "Screen capture.jpg", { type });
}

/**
 * A picker in the composer's bar. With room it shows its value; in icon form, or when the bar has
 * folded it into ⋯, its rows still choose (as a submenu of ⋯).
 */
function picker(input: {
  id: string;
  icon: LucideIcon | ReactNode;
  /** What it picks, the tooltip in icon form and the ⋯ row's name. */
  name: string;
  value: string;
  priority: number;
  rows: ReactNode;
  disabled?: boolean;
  shrink?: boolean;
  /** Always icon-only, even with room (Permissions, which is a shield). */
  iconOnly?: boolean;
}): ActionBarItem {
  const icon = input.icon as ActionBarItem["icon"];
  return {
    id: input.id,
    icon,
    label: input.iconOnly ? `${input.name}: ${input.value}` : input.value,
    priority: input.priority,
    shrink: input.shrink,
    disabled: input.disabled,
    menu: input.rows,
    render: (mode: ActionBarMode) => (
      <DropdownMenu>
        {mode === "icon" || input.iconOnly ? (
          <MenuTrigger
            label={`${input.name}: ${input.value}`}
            iconOnly
            icon={icon}
            disabled={input.disabled}
            data-tour={`composer-${input.id}`}
          />
        ) : (
          <MenuTrigger
            label={input.name}
            icon={icon}
            value={input.value}
            chevron={false}
            disabled={input.disabled}
            className="max-w-full"
            data-tour={`composer-${input.id}`}
          />
        )}
        <DropdownMenuContent align="start" side="top" className="w-64" data-misty-layer-portal>
          {input.rows}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  };
}

const permissionIcons: Record<PermissionMode, LucideIcon> = {
  ask: Shield,
  auto: ShieldCheck,
  bypass: ShieldOff,
};

/** Manual, Auto or Bypass: whether the agent stops before it changes something. */
export function permissionItem(props: {
  conversationId?: string;
  permission: PermissionMode;
  engine?: string;
  disabled?: boolean;
}): ActionBarItem {
  const allowed = engineOptions(props.engine).modes;
  const rows = (
    <>
      <MenuLabel>Permissions</MenuLabel>
      <MenuRadioGroup
        value={props.permission}
        onValueChange={(next) =>
          void setPermissionMode(props.conversationId, next as PermissionMode)
        }
      >
        {permissionModes
          // Bypass is an outside engine's own flag; it isn't offered where it can't apply.
          .filter((option) => option.id !== "bypass" || allowed.includes("bypass"))
          .map((option) => (
            <MenuRadioItem
              key={option.id}
              icon={permissionIcons[option.id]}
              value={option.id}
              label={option.label}
              disabled={!allowed.includes(option.id)}
              reason={allowed.includes(option.id) ? undefined : "This engine can't run this way"}
            />
          ))}
      </MenuRadioGroup>
    </>
  );
  return picker({
    id: "permissions",
    icon: permissionIcons[props.permission],
    name: "Permissions",
    value: permissionModeLabel(props.permission),
    priority: 4,
    rows,
    disabled: props.disabled,
    iconOnly: true,
  });
}

/** How hard the engine thinks. None for an engine that has no levels to choose. */
export function effortItem(props: {
  accountId: string;
  conversationId?: string;
  engine?: string;
  choices: ComposerChoices;
  agentEffort?: string;
  disabled?: boolean;
}): ActionBarItem | null {
  const { efforts } = engineOptions(props.engine);
  if (!efforts.length) return null;
  const current = props.choices.effort || props.agentEffort || "";
  const shown = current && efforts.includes(current) ? effortLabel(current) : "Default";
  const rows = (
    <>
      <MenuLabel>Reasoning effort</MenuLabel>
      <MenuRadioGroup
        value={props.choices.effort}
        onValueChange={(effort) =>
          useComposerChoices.getState().choose(props.accountId, props.conversationId, { effort })
        }
      >
        <MenuRadioItem
          value=""
          label={
            props.agentEffort
              ? `Agent's default (${effortLabel(props.agentEffort)})`
              : "Engine's default"
          }
        />
        {efforts.map((effort) => (
          <MenuRadioItem key={effort} value={effort} label={effortLabel(effort)} />
        ))}
      </MenuRadioGroup>
      <CodexFastItem engine={props.engine} />
    </>
  );
  return picker({
    id: "effort",
    icon: Gauge,
    name: "Reasoning effort",
    value: shown,
    priority: 3,
    rows,
    disabled: props.disabled,
  });
}

const modeIcons: Record<"act" | "plan" | "teach", LucideIcon> = {
  act: Hammer,
  plan: ClipboardList,
  teach: GraduationCap,
};

/** Build or Plan. Shift+Tab switches too. The next message uses it. */
export function modeItem(props: {
  conversationId?: string;
  mode: ConversationMode;
  engine?: string;
  disabled?: boolean;
}): ActionBarItem {
  const canPlan = engineOptions(props.engine).modes.includes("plan");
  const current = props.mode === "plan" ? "plan" : props.mode === "teach" ? "teach" : "act";
  const label = current === "teach" ? "Teach" : current === "plan" ? "Plan" : "Build";
  const rows = (
    <>
      <MenuLabel>Mode</MenuLabel>
      <MenuRadioGroup
        value={current === "teach" ? "" : current}
        onValueChange={(next) =>
          void useCollaborationStore
            .getState()
            .setMode(props.conversationId, next as ConversationMode)
        }
      >
        <MenuRadioItem icon={Hammer} value="act" label="Build" />
        <MenuRadioItem
          icon={ClipboardList}
          value="plan"
          label="Plan"
          disabled={!canPlan}
          reason={canPlan ? undefined : "This engine can't plan without changing anything"}
        />
      </MenuRadioGroup>
    </>
  );
  return picker({
    id: "mode",
    icon: modeIcons[current],
    name: "Mode",
    value: label,
    priority: 5,
    rows,
    disabled: props.disabled,
  });
}

const modelCache = new Map<string, Promise<EngineModel[]>>();
// Settings › Engines changed (a channel, or the model names the person added): read them again.
if (typeof window !== "undefined")
  window.addEventListener("misty:engine-channels-changed", () => modelCache.clear());

/** The models an engine offers, read once per engine. */
export function useEngineModels(engine: string | undefined) {
  const [models, setModels] = useState<{ engine: string; list: EngineModel[] }>();
  useEffect(() => {
    if (!engine || engine === mistyEngine) return;
    let current = true;
    let pending = modelCache.get(engine);
    if (!pending) {
      pending = listEngineModels(engine).catch(() => []);
      modelCache.set(engine, pending);
    }
    void pending.then((list) => current && setModels({ engine, list }));
    return () => {
      current = false;
    };
  }, [engine]);
  return models && models.engine === engine ? models.list : undefined;
}

/** The model the engine is asked for in this chat, out of what the engine offers. */
export function modelItem(props: {
  accountId: string;
  conversationId?: string;
  engine?: string;
  engineName?: string;
  models?: EngineModel[];
  choices: ComposerChoices;
  agentModel?: string;
  disabled?: boolean;
}): ActionBarItem | null {
  if (!props.engine || props.engine === mistyEngine) return null;
  const current = props.choices.model || props.agentModel || "";
  const fallback = props.models?.find((model) => model.default)?.id;
  const shown = current || fallback || "Default model";
  const icon = hasEngineMark(props.engine) ? <EngineMark engine={props.engine} size={16} /> : Cpu;
  const list = [...(props.models ?? [])];
  if (current && !list.some((model) => model.id === current))
    list.unshift({ id: current, default: false });
  const rows = (
    <>
      <MenuLabel>{props.engineName ?? "Model"}</MenuLabel>
      <MenuRadioGroup
        value={props.choices.model}
        onValueChange={(model) =>
          useComposerChoices.getState().choose(props.accountId, props.conversationId, { model })
        }
      >
        <MenuRadioItem
          value=""
          label={props.agentModel ? `Agent's default (${props.agentModel})` : "Engine's default"}
        />
        {list.length ? <MenuSeparator /> : null}
        {list.map((model) => (
          <MenuRadioItem key={model.id} value={model.id} label={model.id} />
        ))}
      </MenuRadioGroup>
    </>
  );
  return picker({
    id: "model",
    icon,
    name: "Model",
    value: shown,
    priority: 6,
    rows,
    disabled: props.disabled,
    shrink: true,
  });
}

/** Misty's browser, attached to the message: the engine is told to work there, and gets its tools. */
export function BrowserChip(props: { onRemove(): void }) {
  return (
    <span className="composer-attached-chip">
      <Globe aria-hidden className="size-3.5 shrink-0" />
      <span>Misty's browser</span>
      <IconButton label="Remove Misty's browser" size="sm" onClick={props.onRemove}>
        <X />
      </IconButton>
    </span>
  );
}
