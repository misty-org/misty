import {
  cn,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
} from "@/shared/ui";
import { useContext, type ReactNode } from "react";

import { SettingsControlLabelContext } from "./components/DesktopSettingsUI";

export function useSettingsControlLabel(fallback: string) {
  return useContext(SettingsControlLabelContext) ?? fallback;
}
export function SettingsNote(props: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-2xl py-2 text-[14px] leading-5 text-cream-muted">{props.children}</p>
  );
}

export function SelectControl(props: {
  value: number;
  options: string[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <ChoiceControl
      value={String(props.value)}
      options={props.options.map((label, value) => ({ value: String(value), label }))}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(Number(value))}
    />
  );
}

/** Shared checkmarked dropdown for longer lists of choices. */
export function DropdownControl(props: {
  value: string;
  label?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  className?: string;
  onValueChange(value: string): void;
}) {
  const label = useSettingsControlLabel("Setting");
  return (
    <Select value={props.value} disabled={props.disabled} onValueChange={props.onValueChange}>
      <SelectTrigger
        aria-label={props.label ?? label}
        className={cn("w-[200px] max-w-full", props.className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Up to four short options render as a segmented control; anything longer is a dropdown. */
export function ChoiceControl(props: {
  value: string;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  disabled: boolean;
  onValueChange(value: string): void;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  const labelLength = props.options.reduce((total, option) => total + option.label.length, 0);
  if (props.options.length <= 4 && labelLength <= 24) {
    return (
      <SegmentedControl
        label={ariaLabel}
        value={props.value}
        options={props.options}
        disabled={props.disabled}
        onChange={props.onValueChange}
      />
    );
  }
  return (
    <DropdownControl
      value={props.value}
      options={props.options}
      disabled={props.disabled}
      onValueChange={props.onValueChange}
    />
  );
}

export function SwitchControl(props: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  return (
    <Switch
      aria-label={ariaLabel}
      className={cn(
        "disabled:border-charcoal-border/80 disabled:bg-charcoal-bg disabled:opacity-100",
        "disabled:[&_[data-slot=switch-thumb]]:bg-charcoal-border",
        "disabled:[&_[data-slot=switch-thumb]]:ring-charcoal-border",
      )}
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={props.onChange}
    />
  );
}

export function SliderControl(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  format?: (value: number) => string;
  onChange?: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  const format = props.format ?? ((value: number) => String(value));
  return (
    <div className="flex w-[220px] max-w-full items-center gap-3">
      <Slider
        aria-label={ariaLabel}
        aria-valuetext={format(props.value)}
        className={cn(
          "flex-1",
          props.disabled &&
            cn(
              "[&_[data-slot=slider-range]]:bg-charcoal-border",
              "[&_[data-slot=slider-thumb]]:border-charcoal-border",
              "[&_[data-slot=slider-thumb]]:bg-charcoal-border",
              "[&_[data-slot=slider-thumb]]:opacity-100",
              "[&_[data-slot=slider-track]]:bg-charcoal-bg",
            ),
        )}
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        onValueChange={(next) => {
          const value = next[0];
          if (typeof value === "number") (props.onChange ?? props.onCommit)(value);
        }}
        onValueCommit={(next) => {
          const value = next[0];
          if (props.onChange && typeof value === "number") props.onCommit(value);
        }}
      />
      <span
        className={cn(
          "w-12 shrink-0 text-right text-sm font-medium tabular-nums",
          props.disabled ? "text-cream-muted" : "text-cream",
        )}
      >
        {format(props.value)}
      </span>
    </div>
  );
}

/** Multi-line free text, committed on blur like {@link TextControl}. */

export * from "./SettingsTextControls";
export * from "./settingsValues";
