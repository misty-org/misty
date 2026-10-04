import {
  Button,
  cn,
  IconButton,
  Input,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
} from "@/shared/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy } from "lucide-react";
import { useContext, useState, type ChangeEvent, type ReactNode } from "react";

import {
  settingsControlButtonCompactClass,
  settingsDisabledControlClass,
} from "./settingsConstants";
import { SettingsControlLabelContext } from "./components/DesktopSettingsUI";

function useSettingsControlLabel(fallback: string) {
  return useContext(SettingsControlLabelContext) ?? fallback;
}
export function SettingsNote(props: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-2xl px-5 py-4 text-[13px] leading-[18px] text-cream-muted">
      {props.children}
    </p>
  );
}

export function WorkspaceRootControl(props: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);

  const chooseFolder = async () => {
    setChoosing(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose workspace root",
      });
      if (typeof selected === "string") props.onChange(selected);
    } finally {
      setChoosing(false);
    }
  };

  return (
    <div className="grid min-w-0 justify-items-end gap-2 max-[760px]:justify-items-start">
      <span
        className={cn(
          "max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm",
          "max-[760px]:text-left",
          props.disabled || !props.value ? "text-cream-muted" : "text-cream",
        )}
        title={props.value || "Default"}
      >
        {props.value || "Default"}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || choosing}
          title="Choose workspace root"
          onClick={() => void chooseFolder()}
        >
          {choosing ? "Choosing…" : "Choose"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || !props.value}
          onClick={() => props.onChange("")}
        >
          Reset
        </Button>
      </div>
    </div>
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

/** Shared checkmarked dropdown for larger lists of account connections. */
export function DropdownControl(props: {
  value: string;
  label?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onValueChange(value: string): void;
}) {
  const label = useSettingsControlLabel("Setting");
  return (
    <Select value={props.value} disabled={props.disabled} onValueChange={props.onValueChange}>
      <SelectTrigger aria-label={props.label ?? label} className="w-full min-w-0">
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

/** Visible choices keep settings discoverable without opening a dropdown. */
export function ChoiceControl(props: {
  value: string;
  presentation?: "list" | "pills";
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  disabled: boolean;
  onValueChange(value: string): void;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  if (props.presentation === "pills") {
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
    <RadioGroup
      value={props.value}
      onValueChange={props.onValueChange}
      aria-label={ariaLabel}
      disabled={props.disabled}
      className="grid min-w-0 gap-2 text-sm text-cream disabled:text-cream-muted"
    >
      {props.options.map((option) => (
        <label
          key={option.value}
          title={option.title}
          className={cn(
            "flex items-center gap-2",
            option.disabled ? "cursor-default text-cream-muted" : "cursor-pointer",
          )}
        >
          <RadioGroupItem
            value={option.value}
            aria-label={option.label}
            className="size-3.5 shrink-0"
            disabled={option.disabled}
          />
          {option.label}
        </label>
      ))}
    </RadioGroup>
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

export function TextControl(props: {
  value: string;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  wide?: boolean;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  const handleCommit = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.value !== props.value) {
      props.onCommit(event.currentTarget.value);
    }
  };

  return (
    <Input
      aria-label={ariaLabel}
      key={props.value}
      className={cn(
        props.wide ? "w-full max-w-[520px]" : "w-[220px] max-w-full",
        settingsDisabledControlClass,
      )}
      defaultValue={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onBlur={handleCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A continuous value with its current reading, e.g. panel opacity or zoom. */
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
export function TextAreaControl(props: {
  value: string;
  placeholder?: string;
  rows?: number;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const ariaLabel = useSettingsControlLabel("Setting");
  return (
    <Textarea
      aria-label={ariaLabel}
      key={props.value}
      className={cn("w-full max-w-[520px] font-mono text-xs", settingsDisabledControlClass)}
      defaultValue={props.value}
      placeholder={props.placeholder}
      rows={props.rows ?? 4}
      disabled={props.disabled}
      onBlur={(event) => {
        if (event.currentTarget.value !== props.value) props.onCommit(event.currentTarget.value);
      }}
    />
  );
}

/** Picks a single file — the wallpaper row. Mirrors {@link WorkspaceRootControl}. */
export function FilePathControl(props: {
  value: string;
  title: string;
  filters?: { name: string; extensions: string[] }[];
  emptyLabel?: string;
  /** Choose a folder instead of a file. */
  directory?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);

  const chooseFile = async () => {
    setChoosing(true);
    try {
      const selected = await open({
        directory: props.directory ?? false,
        multiple: false,
        title: props.title,
        filters: props.filters,
      });
      if (typeof selected === "string") props.onChange(selected);
    } finally {
      setChoosing(false);
    }
  };

  return (
    <div className="grid min-w-0 justify-items-end gap-2 max-[760px]:justify-items-start">
      <span
        className={cn(
          "max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm",
          "max-[760px]:text-left",
          props.disabled || !props.value ? "text-cream-muted" : "text-cream",
        )}
        title={props.value || props.emptyLabel || "None"}
      >
        {props.value || props.emptyLabel || "None"}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || choosing}
          title={props.title}
          onClick={() => void chooseFile()}
        >
          {choosing ? "Choosing…" : "Choose"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className={settingsControlButtonCompactClass}
          disabled={props.disabled || !props.value}
          onClick={() => props.onChange("")}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

export function CopyableValueText(props: { value: string; disabled?: boolean }) {
  const settingLabel = useSettingsControlLabel("value");
  const copyValue = () => {
    if (props.disabled) return;
    void navigator.clipboard?.writeText(props.value).catch(() => undefined);
  };

  return (
    <span className="flex min-w-0 max-w-[420px] items-center justify-end gap-2 max-[760px]:justify-start">
      <span
        className={`min-w-0 select-text overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.disabled ? "text-cream-muted" : "text-cream"}`}
        title={props.value}
      >
        {props.value}
      </span>
      <IconButton
        size="md"
        variant="outline"
        label={`Copy ${settingLabel.toLowerCase()}`}
        className={settingsDisabledControlClass}
        disabled={props.disabled}
        title="Copy"
        onClick={copyValue}
      >
        <Copy size={14} />
      </IconButton>
    </span>
  );
}

export function sectionRecord(
  document: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = document[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function numberSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: number,
): number {
  const value = sectionRecord(document, section)[key];
  return typeof value === "number" ? value : fallback;
}

export function booleanSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: boolean,
): boolean {
  const value = sectionRecord(document, section)[key];
  return typeof value === "boolean" ? value : fallback;
}

export function stringSetting(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: string,
): string {
  const value = sectionRecord(document, section)[key];
  return typeof value === "string" ? value : fallback;
}
