import {
  ChoiceGroup,
  cn,
  OptionSelect,
  Slider,
  Switch,
  Text,
  type MenuIcon,
  type SelectOption,
} from "@misty/ui";
import { useContext } from "react";

import { SettingsControlLabelContext } from "./components/DesktopSettingsUI";

export function useSettingsControlLabel(fallback: string) {
  return useContext(SettingsControlLabelContext) ?? fallback;
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

interface DropdownOption {
  value: string;
  label: string;
  icon?: MenuIcon;
  disabled?: boolean;
  title?: string;
}

export function DropdownControl(props: {
  value: string;
  label?: string;
  options: DropdownOption[];
  disabled?: boolean;
  className?: string;
  onValueChange(value: string): void;
}) {
  const label = useSettingsControlLabel("Setting");
  return (
    <OptionSelect
      aria-label={props.label ?? label}
      className={cn("w-50 max-w-full", props.className)}
      value={props.value}
      options={props.options.map((option): SelectOption => ({
        value: option.value,
        label: option.label,
        icon: option.icon as MenuIcon,
        disabled: option.disabled,
        reason: option.title,
      }))}
      disabled={props.disabled}
      onValueChange={props.onValueChange}
    />
  );
}

const emptyChoice = "__settings_empty_choice__";

export function ChoiceControl(props: {
  value: string;
  options: DropdownOption[];
  disabled: boolean;
  onValueChange(value: string): void;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  const labelLength = props.options.reduce((total, option) => total + option.label.length, 0);
  if (props.options.length <= 4 && labelLength <= 24) {
    return (
      <ChoiceGroup
        label={ariaLabel}
        value={props.value || emptyChoice}
        options={props.options.map((option) => ({
          value: option.value || emptyChoice,
          label: option.label,
          disabled: option.disabled,
          reason: option.title,
        }))}
        disabled={props.disabled}
        onChange={(value) => props.onValueChange(value === emptyChoice ? "" : value)}
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
    <div className="flex w-55 max-w-full items-center gap-3">
      <Slider
        aria-label={ariaLabel}
        aria-valuetext={format(props.value)}
        className="flex-1"
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
      <Text
        bare
        size="meta"
        tone={props.disabled ? "muted" : "default"}
        weight="medium"
        className="w-12 shrink-0 text-right tabular-nums"
      >
        {format(props.value)}
      </Text>
    </div>
  );
}

export * from "./SettingsTextControls";
export * from "./settings_values";
