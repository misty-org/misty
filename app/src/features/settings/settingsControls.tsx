import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  Button,
  Input,
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
import { type ChangeEvent, type ReactNode } from "react";

import { settingsControlButtonCompactClass } from "./settingsConstants";
export function SettingsNote(props: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-2xl px-5 py-4 text-sm leading-5 text-cream-muted">{props.children}</p>
  );
}

export function WorkspaceRootControl(props: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const pickerAvailable = hasTauriInternals();
  const chooseFolder = async () => {
    if (!pickerAvailable) return;
    const selection = await open({
      title: "Choose Workspace Root",
      multiple: false,
      directory: true,
    });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (path) props.onChange(path);
  };

  return (
    <div className="grid min-w-0 justify-items-end gap-2 max-[760px]:justify-items-start">
      <span
        className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.value ? "text-cream" : "text-cream-muted"}`}
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
          disabled={props.disabled || !pickerAvailable}
          title={
            pickerAvailable ? "Choose workspace root" : "Folder picker unavailable on this platform"
          }
          onClick={() => void chooseFolder()}
        >
          Choose
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
    <Select
      value={String(Math.min(props.value, props.options.length - 1))}
      disabled={props.disabled}
      onValueChange={(value) => props.onChange(Number(value))}
    >
      <SelectTrigger className="w-[220px] max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option, index) => (
          <SelectItem key={option} value={String(index)}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SwitchControl(props: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
  );
}

export function TextControl(props: {
  value: string;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  wide?: boolean;
}) {
  const handleCommit = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.value !== props.value) {
      props.onCommit(event.currentTarget.value);
    }
  };

  return (
    <Input
      key={props.value}
      className={props.wide ? "w-full max-w-[520px]" : "w-[220px] max-w-full"}
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
  onCommit: (value: number) => void;
}) {
  const format = props.format ?? ((value: number) => String(value));
  return (
    <div className="flex w-[220px] max-w-full items-center gap-3">
      <Slider
        className="flex-1"
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        onValueChange={(next) => {
          const value = next[0];
          if (typeof value === "number") props.onCommit(value);
        }}
      />
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-cream-muted">
        {format(props.value)}
      </span>
    </div>
  );
}

export function NumberControl(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(props.max, Math.max(props.min, parsed));
    if (clamped !== props.value) props.onCommit(clamped);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        key={props.value}
        type="number"
        className="w-[110px]"
        defaultValue={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {props.suffix ? <span className="text-sm text-cream-muted">{props.suffix}</span> : null}
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
  return (
    <Textarea
      key={props.value}
      className="w-full max-w-[520px] font-mono text-xs"
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
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const pickerAvailable = hasTauriInternals();
  const chooseFile = async () => {
    if (!pickerAvailable) return;
    const selection = await open({ title: props.title, multiple: false, filters: props.filters });
    const path = Array.isArray(selection) ? selection[0] : selection;
    if (path) props.onChange(path);
  };

  return (
    <div className="grid min-w-0 justify-items-end gap-2 max-[760px]:justify-items-start">
      <span
        className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.value ? "text-cream" : "text-cream-muted"}`}
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
          disabled={props.disabled || !pickerAvailable}
          title={pickerAvailable ? props.title : "File picker unavailable on this platform"}
          onClick={() => void chooseFile()}
        >
          Choose
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

export function ValueText(props: { value: string; muted?: boolean }) {
  return (
    <span
      className={`max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-right text-sm max-[760px]:text-left ${props.muted ? "text-cream-muted" : "text-cream"}`}
    >
      {props.value}
    </span>
  );
}

export function CopyableValueText(props: { value: string; disabled?: boolean }) {
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
      <Button
        variant="outline"
        size="icon"
        type="button"
        disabled={props.disabled}
        aria-label="Copy value"
        title="Copy"
        onClick={copyValue}
      >
        <Copy size={14} />
      </Button>
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
