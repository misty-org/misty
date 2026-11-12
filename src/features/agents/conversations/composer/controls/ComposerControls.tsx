import {
  ClipboardList,
  Gauge,
  Globe,
  Hammer,
  Scan,
  Shield,
  ShieldCheck,
  ShieldOff,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  IconButton,
  MenuTrigger,
} from "@/shared/ui";
import { invoke } from "@/native/invoke";
import { captureAttachmentFromDataUrl } from "../../../runs/invocations/captureAttachment";
import { AgentGoalDialog } from "../../../plans/AgentGoalDialog";
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
import { useChatChoices, useComposerChoices } from "./composerChoices";
import { effortLabel, engineOptions } from "./engineOptions";

/** A quiet chip in the composer's bar: an icon, and its value where there is room. */
function Chip(props: {
  label: string;
  title: string;
  icon: React.ReactNode;
  value?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <MenuTrigger
      label={props.label}
      title={props.title}
      icon={props.icon}
      value={props.value}
      chevron={false}
      disabled={props.disabled}
      className="composer-chip"
    />
  );
}

const chipIcon = (Icon: LucideIcon) => <Icon aria-hidden className="size-4 shrink-0" />;

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

export function CaptureButton(props: { disabled?: boolean; onCapture(): void }) {
  return (
    <IconButton
      label="Capture part of the screen"
      variant="toolbar"
      disabled={props.disabled}
      className="composer-icon"
      onClick={props.onCapture}
    >
      <Scan className="size-4" />
    </IconButton>
  );
}

/** Manual or Auto: whether the agent stops before it changes something. */
export function PermissionMenu(props: {
  conversationId?: string;
  permission: PermissionMode;
  engine?: string;
  disabled?: boolean;
}) {
  const allowed = engineOptions(props.engine).modes;
  const Icon =
    props.permission === "bypass" ? ShieldOff : props.permission === "auto" ? ShieldCheck : Shield;
  const label = permissionModeLabel(props.permission);
  return (
    <DropdownMenu>
      <MenuTrigger
        label="Permissions"
        title={`Permissions: ${label}`}
        iconOnly
        icon={<Icon className="size-4" />}
        disabled={props.disabled}
        className={cn("composer-icon", props.permission !== "ask" && "text-cream")}
      />
      <DropdownMenuContent align="start" className="w-64" data-misty-layer-portal>
        <DropdownMenuLabel>Permissions</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.permission}
          onValueChange={(next) =>
            void setPermissionMode(props.conversationId, next as PermissionMode)
          }
        >
          {permissionModes
            // Bypass is an outside engine's own flag; it isn't offered where it can't apply.
            .filter((option) => option.id !== "bypass" || allowed.includes("bypass"))
            .map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                disabled={!allowed.includes(option.id)}
                className="items-start"
              >
                <span className="grid gap-0.5">
                  <span>{option.label}</span>
                  <span className="text-xs text-cream-muted">{option.description}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The chat's goal: set one, or see how it is going. */
export function GoalButton(props: { conversationId?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const goal = useCollaborationStore((s) =>
    props.conversationId ? s.byConversation[props.conversationId]?.goal : undefined,
  );
  const active = goal?.status === "pursuing" || goal?.status === "paused";
  return (
    <>
      <IconButton
        label={active && goal ? `Goal: ${goal.objective}` : "Set a goal"}
        variant="toolbar"
        disabled={props.disabled || !props.conversationId}
        className={cn("composer-icon", active && "text-cream")}
        data-active={active || undefined}
        onClick={() => setOpen(true)}
      >
        <Target className="size-4" />
      </IconButton>
      <AgentGoalDialog conversationId={props.conversationId} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** How hard the engine thinks. Hidden for an engine that has no levels to choose. */
export function EffortMenu(props: {
  accountId: string;
  conversationId?: string;
  engine?: string;
  agentEffort?: string;
  disabled?: boolean;
}) {
  const { efforts } = engineOptions(props.engine);
  const choices = useChatChoices(props.conversationId);
  if (!efforts.length) return null;
  const current = choices.effort || props.agentEffort || "";
  const shown = current && efforts.includes(current) ? effortLabel(current) : "Default";
  return (
    <DropdownMenu>
      <Chip
        label="Reasoning effort"
        title={`Reasoning effort: ${shown}`}
        icon={chipIcon(Gauge)}
        value={shown}
        disabled={props.disabled}
      />
      <DropdownMenuContent align="end" className="w-48" data-misty-layer-portal>
        <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choices.effort}
          onValueChange={(effort) =>
            useComposerChoices.getState().choose(props.accountId, props.conversationId, { effort })
          }
        >
          <DropdownMenuRadioItem value="">
            {props.agentEffort
              ? `Agent's default (${effortLabel(props.agentEffort)})`
              : "Engine's default"}
          </DropdownMenuRadioItem>
          {efforts.map((effort) => (
            <DropdownMenuRadioItem key={effort} value={effort}>
              {effortLabel(effort)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <CodexFastItem engine={props.engine} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const modeIcons: Record<"act" | "plan", LucideIcon> = { act: Hammer, plan: ClipboardList };

/** Build or Plan. Shift+Tab switches too. The next message uses it. */
export function ModeMenu(props: {
  conversationId?: string;
  mode: ConversationMode;
  engine?: string;
  disabled?: boolean;
}) {
  const canPlan = engineOptions(props.engine).modes.includes("plan");
  const current = props.mode === "plan" ? "plan" : "act";
  const label = props.mode === "teach" ? "Teach" : current === "plan" ? "Plan" : "Build";
  return (
    <DropdownMenu>
      <Chip
        label="Mode"
        title={`Mode: ${label} · Shift+Tab switches Plan`}
        icon={chipIcon(modeIcons[current])}
        value={label}
        disabled={props.disabled}
      />
      <DropdownMenuContent align="end" className="w-60" data-misty-layer-portal>
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.mode === "teach" ? "" : current}
          onValueChange={(next) =>
            void useCollaborationStore
              .getState()
              .setMode(props.conversationId, next as ConversationMode)
          }
        >
          <DropdownMenuRadioItem value="act" className="items-start">
            <span className="grid gap-0.5">
              <span>Build</span>
              <span className="text-xs text-cream-muted">Works on the task and makes changes</span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="plan" disabled={!canPlan} className="items-start">
            <span className="grid gap-0.5">
              <span>Plan</span>
              <span className="text-xs text-cream-muted">Reads and proposes a plan first</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const modelCache = new Map<string, Promise<EngineModel[]>>();
// Settings › Engines changed (a channel, or the model names the person added): read them again.
if (typeof window !== "undefined")
  window.addEventListener("misty:engine-channels-changed", () => modelCache.clear());

function useEngineModels(engine: string | undefined) {
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
export function ModelMenu(props: {
  accountId: string;
  conversationId?: string;
  engine?: string;
  engineName?: string;
  agentModel?: string;
  disabled?: boolean;
}) {
  const choices = useChatChoices(props.conversationId);
  const models = useEngineModels(props.engine);
  if (!props.engine || props.engine === mistyEngine) return null;
  const current = choices.model || props.agentModel || "";
  const fallback = models?.find((model) => model.default)?.id;
  const shown = current || fallback || "Default model";
  const mark = hasEngineMark(props.engine) ? <EngineMark engine={props.engine} size={14} /> : null;
  const list = [...(models ?? [])];
  if (current && !list.some((model) => model.id === current))
    list.unshift({ id: current, default: false });
  return (
    <DropdownMenu>
      <Chip
        label="Model"
        title={`${props.engineName ?? props.engine} · ${shown}`}
        icon={
          mark ?? <span aria-hidden className="size-4 shrink-0 rounded-full bg-cream-muted/40" />
        }
        value={shown}
        disabled={props.disabled}
      />
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-64 overflow-y-auto"
        data-misty-layer-portal
      >
        <DropdownMenuLabel>{props.engineName ?? "Model"}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choices.model}
          onValueChange={(model) =>
            useComposerChoices.getState().choose(props.accountId, props.conversationId, { model })
          }
        >
          <DropdownMenuRadioItem value="">
            {props.agentModel ? `Agent's default (${props.agentModel})` : "Engine's default"}
          </DropdownMenuRadioItem>
          {list.length ? <DropdownMenuSeparator /> : null}
          {list.map((model) => (
            <DropdownMenuRadioItem key={model.id} value={model.id}>
              <span className="truncate">{model.id}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Misty's browser, attached to the message: the engine is told to work there, and gets its tools. */
export function BrowserChip(props: { onRemove(): void }) {
  return (
    <span className="composer-attached-chip">
      <Globe aria-hidden className="size-3.5 shrink-0" />
      <span>Misty's browser</span>
      <IconButton
        label="Remove Misty's browser"
        size="2xs"
        variant="ghost"
        tooltip={false}
        onClick={props.onRemove}
      >
        <X className="size-3" />
      </IconButton>
    </span>
  );
}
