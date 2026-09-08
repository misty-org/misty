import {
  formatShortcut,
  type ShortcutCommandDefinition,
  type ShortcutSlot,
} from "@/features/shortcuts";
import type { ShortcutBindingSet } from "@/native/ipc";
import { Button, cn, IconButton, Pressable } from "@/shared/ui";
import { RotateCcw, Trash2 } from "lucide-react";
import { DesktopSettingsRow } from "../components/DesktopSettingsUI";
import { settingsDisabledControlClass } from "../settingsConstants";

export interface CaptureTarget {
  commandId: string;
  slot: ShortcutSlot;
}

/** One command as a settings row: its name on the left, primary and alternate keys on the right. */
export function ShortcutCommandRow(props: {
  definition: ShortcutCommandDefinition;
  binding: ShortcutBindingSet;
  platform: "macos" | "windows" | "linux";
  capture: CaptureTarget | null;
  /** A capture error or a conflict to resolve, shown in place of a description. */
  problem: { message: string; onReassign?: () => void; onCancel?: () => void } | null;
  disabled: boolean;
  onBegin: (target: CaptureTarget) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, target: CaptureTarget) => void;
  onClear: (target: CaptureTarget) => void;
  onRestore: () => void;
}) {
  const { definition, binding } = props;
  const customized = binding.primarySource === "user" || binding.alternateSource === "user";
  const slot = (label: string, name: ShortcutSlot) => (
    <BindingSlot
      label={label}
      commandId={definition.id}
      slot={name}
      value={binding[name]}
      source={name === "primary" ? binding.primarySource : binding.alternateSource}
      platform={props.platform}
      capturing={props.capture?.commandId === definition.id && props.capture.slot === name}
      disabled={props.disabled}
      onBegin={props.onBegin}
      onKeyDown={props.onKeyDown}
      onClear={props.onClear}
    />
  );
  return (
    <DesktopSettingsRow
      label={definition.label}
      description={
        props.problem ? (
          <span role="alert" className="text-cream">
            {props.problem.message}
            {props.problem.onReassign ? (
              <span className="ml-2 inline-flex gap-1.5 align-middle">
                <Button type="button" size="sm" onClick={props.problem.onReassign}>
                  Reassign
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={props.problem.onCancel}>
                  Cancel
                </Button>
              </span>
            ) : null}
          </span>
        ) : (
          definition.description || undefined
        )
      }
    >
      {slot("Primary", "primary")}
      {slot("Alternate", "alternate")}
      <IconButton
        label={`Restore ${definition.label}`}
        className={settingsDisabledControlClass}
        title="Restore default"
        disabled={props.disabled || !customized}
        onClick={props.onRestore}
      >
        <RotateCcw size={13} />
      </IconButton>
    </DesktopSettingsRow>
  );
}

function BindingSlot(props: {
  label: string;
  commandId: string;
  slot: ShortcutSlot;
  value: string | null;
  source: "default" | "user";
  platform: "macos" | "windows" | "linux";
  capturing: boolean;
  disabled: boolean;
  onBegin: (target: CaptureTarget) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, target: CaptureTarget) => void;
  onClear: (target: CaptureTarget) => void;
}) {
  const target = { commandId: props.commandId, slot: props.slot };
  return (
    <div className="group/slot relative min-w-[106px]">
      <Pressable
        disabled={props.disabled}
        aria-label={`${props.label} shortcut${props.value ? `: ${props.value}` : ": unbound"}`}
        onClick={() => props.onBegin(target)}
        onKeyDown={(event) => (props.capturing ? props.onKeyDown(event, target) : undefined)}
        className={cn(
          "flex h-8 w-full items-center justify-center gap-0.5 rounded border px-2",
          "text-xs",
          props.capturing
            ? "border-charcoal-active bg-charcoal-hover text-cream ring-1 ring-charcoal-active/40"
            : "border-charcoal-border bg-charcoal-bg text-cream-muted hover:border-charcoal-active",
          settingsDisabledControlClass,
        )}
      >
        {props.capturing ? (
          <span>Press shortcut…</span>
        ) : props.value ? (
          formatShortcut(props.value, props.platform).map((keycap) => (
            <kbd key={keycap} className="font-sans text-[11px]">
              {keycap}
            </kbd>
          ))
        ) : (
          <span className="text-cream-muted">Unbound</span>
        )}
      </Pressable>
      {props.value ? (
        <IconButton
          size="2xs"
          variant="secondary"
          shape="round"
          label={`Clear ${props.label.toLowerCase()} shortcut`}
          className={cn(
            "absolute -right-1 -top-1 opacity-0 transition-opacity",
            "group-hover/slot:opacity-100 group-focus-within/slot:opacity-100 max-[720px]:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            props.onClear(target);
          }}
        >
          <Trash2 size={9} />
        </IconButton>
      ) : null}
      <span className="sr-only">{props.source === "user" ? "Custom" : "Default"}</span>
    </div>
  );
}
