import {
  ClipboardList,
  Cpu,
  Globe,
  Keyboard,
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
  hasMark,
  IconButton,
  Mark,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  ModelPicker,
  Surface,
  Text,
  type ActionBarItem,
  type ActionBarMode,
  type ButtonIcon,
} from "@misty/ui";
import { invoke } from "@/native/invoke";
import { captureAttachmentFromDataUrl } from "../../../runs/invocations/capture_attachment";
import { EngineFastItem } from "../../view/engine/EngineFastItem";
import { chooseEngineMode } from "../../../plans/permission_mode";
import type { EngineModeKind, EngineModeOption } from "../../../engines/engine_modes";
import {
  engineModels,
  mistyEngine,
  modelNamed,
  usablePick,
  type EngineModel,
} from "../../../engines/engines_api";
import { modelName } from "../../../engines/model_names";
import { useComposerChoices, useModelEfforts, type ComposerChoices } from "./composer_choices";
import { effectiveEffort, effortLabel, effortNote, modelEfforts } from "./engine_options";
import { useComposerVim } from "./composer_vim";
import type { VimMode } from "./vim_keys";

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

function picker(input: {
  id: string;
  icon: LucideIcon | ReactNode;
  name: string;
  value: string;
  priority: number;
  rows: ReactNode;
  disabled?: boolean;
  shrink?: boolean;
}): ActionBarItem {
  const icon = input.icon as ActionBarItem["icon"];
  return {
    id: input.id,
    icon,
    label: input.value,
    priority: input.priority,
    shrink: input.shrink,
    disabled: input.disabled,
    menu: input.rows,
    render: (mode: ActionBarMode) => (
      <DropdownMenu>
        {mode === "icon" ? (
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

const modeIcons: Record<EngineModeKind, LucideIcon> = {
  asks: Shield,
  edits: ShieldCheck,
  plans: ClipboardList,
  no_asking: ShieldOff,
};

export function engineModeItem(props: {
  conversationId?: string;
  modes: EngineModeOption[];
  current?: EngineModeOption;
  teaching?: boolean;
  disabled?: boolean;
}): ActionBarItem | null {
  const { modes, current } = props;
  if (modes.length < 2 || !current) return null;
  const rows = (
    <>
      <MenuLabel>Mode</MenuLabel>
      <MenuRadioGroup
        value={current.id}
        onValueChange={(id) => {
          const next = modes.find((mode) => mode.id === id);
          if (next) void chooseEngineMode(props.conversationId, next, props.teaching);
        }}
      >
        {modes.map((mode) => (
          <MenuRadioItem
            key={mode.id}
            icon={modeIcons[mode.kind]}
            value={mode.id}
            label={mode.label}
          />
        ))}
      </MenuRadioGroup>
    </>
  );
  return picker({
    id: "mode",
    icon: modeIcons[current.kind],
    name: "Mode",
    value: current.label,
    priority: 5,
    rows,
    disabled: props.disabled,
  });
}

export function vimItem(props: { on: boolean; mode: VimMode }): ActionBarItem | null {
  if (!props.on) return null;
  return picker({
    id: "vim",
    icon: Keyboard,
    name: "Vim",
    value: props.mode === "normal" ? "Normal" : "Insert",
    priority: 2,
    rows: (
      <>
        <MenuLabel>Vim keys</MenuLabel>
        <MenuItem label="Turn off" onSelect={() => useComposerVim.getState().toggle(false)} />
      </>
    ),
  });
}

export function useEngineModels(engine: string | undefined) {
  const [models, setModels] = useState<{ engine: string; list: EngineModel[] }>();
  useEffect(() => {
    if (!engine || engine === mistyEngine) return;
    let current = true;
    void engineModels(engine).then((list) => current && setModels({ engine, list }));
    return () => {
      current = false;
    };
  }, [engine]);
  return models && models.engine === engine ? models.list : undefined;
}

export function modelEffortItem(props: {
  accountId: string;
  conversationId?: string;
  engine?: string;
  engineName?: string;
  models?: EngineModel[];
  choices: ComposerChoices;
  agentModel?: string;
  agentEffort?: string;
  disabled?: boolean;
}): ActionBarItem | null {
  const engine = props.engine;
  if (!engine || engine === mistyEngine) return null;
  const currentId = usablePick(engine, props.models, props.choices.model || props.agentModel || "");
  const current = modelNamed(props.models, currentId);
  const list = [...(props.models ?? [])];
  if (currentId && !current)
    list.unshift({ id: currentId, label: modelName(currentId, currentId), default: false });
  const value = current?.id ?? currentId;
  const shown = current
    ? current.runs || current.label
    : currentId
      ? modelName(currentId, currentId)
      : "Default model";
  const byId = new Map(list.map((model) => [model.id, model]));
  const effortFor = (id: string) =>
    effectiveEffort({
      engine,
      modelId: id,
      model: byId.get(id),
      chosen: id === value ? props.choices.effort : undefined,
      agentEffort: props.agentEffort,
    });
  const efforts = modelEfforts(engine, current);
  const effort = efforts.length ? effortFor(value) : "";
  const choose = (patch: Partial<ComposerChoices>) =>
    useComposerChoices.getState().choose(props.accountId, props.conversationId, patch);
  const remember = (model: string, level: string) => {
    if (model && level) useModelEfforts.getState().remember(engine, model, level);
  };
  const pick = (model: string, level: string) => {
    choose({ model, effort: level });
    remember(model, level);
  };
  const setEffort = (level: string) => {
    choose({ effort: level });
    remember(value, level);
  };
  const icon: ButtonIcon = hasMark(`engine:${engine}`) ? (
    <Mark of={`engine:${engine}`} size={16} />
  ) : (
    Cpu
  );
  const models =
    props.models === undefined
      ? undefined
      : list.map((model) => ({
          value: model.id,
          label: model.label,
          detail: model.detail ?? undefined,
          efforts: modelEfforts(engine, model),
          keywords: [model.id],
          section: model.section === "more" ? ("more" as const) : ("main" as const),
        }));
  const rows = (
    <>
      <MenuLabel>{props.engineName ?? "Model"}</MenuLabel>
      <MenuRadioGroup value={value} onValueChange={(model) => pick(model, effortFor(model))}>
        {list.map((model) => (
          <MenuRadioItem key={model.id} value={model.id} label={model.label} />
        ))}
      </MenuRadioGroup>
      {efforts.length ? (
        <>
          <MenuSeparator />
          <MenuLabel>Reasoning effort</MenuLabel>
          <MenuRadioGroup value={effort} onValueChange={setEffort}>
            {efforts.map((level) => (
              <MenuRadioItem key={level} value={level} label={effortLabel(level, current)} />
            ))}
          </MenuRadioGroup>
          <EngineFastItem engine={engine} model={current} />
        </>
      ) : null}
    </>
  );
  return {
    id: "model",
    icon: icon as ActionBarItem["icon"],
    label: effort ? `${shown}, ${effortLabel(effort, current)}` : shown,
    priority: 6,
    shrink: true,
    disabled: props.disabled,
    menu: rows,
    render: (mode: ActionBarMode) => (
      <ModelPicker
        label="Model"
        icon={icon}
        models={models}
        value={value}
        shown={shown}
        effort={effort}
        efforts={efforts}
        effortFor={effortFor}
        effortLabel={(level) => effortLabel(level, current)}
        effortNote={(level) => effortNote(level, current)}
        onPick={pick}
        onEffort={setEffort}
        effortRows={<EngineFastItem engine={engine} model={current} />}
        mode={mode}
        disabled={props.disabled}
        tour="composer-model"
      />
    ),
  };
}

export function BrowserChip(props: { onRemove(): void }) {
  return (
    <Surface
      as="span"
      tone="well"
      radius="md"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 pr-1 pl-2.5"
    >
      <Text bare size="meta" tone="default" className="inline-flex items-center gap-1.5">
        <Globe aria-hidden className="shrink-0" />
        <span>Misty's browser</span>
      </Text>
      <IconButton label="Remove Misty's browser" size="sm" onClick={props.onRemove}>
        <X />
      </IconButton>
    </Surface>
  );
}
