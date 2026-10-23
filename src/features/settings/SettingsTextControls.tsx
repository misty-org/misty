import { Button, cn, IconButton, Input, Textarea } from "@/shared/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy } from "lucide-react";
import { useState, type ChangeEvent } from "react";

import {
  settingsControlButtonCompactClass,
  settingsDisabledControlClass,
} from "./settingsConstants";

import { useSettingsControlLabel } from "./SettingsControls";

export function TextControl(props: {
  value: string;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
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
      className={cn("w-[240px] max-w-full", settingsDisabledControlClass)}
      defaultValue={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onBlur={handleCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          // Cancel: restore the saved value; blurring then commits nothing.
          event.currentTarget.value = props.value;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A continuous value with its current reading, e.g. panel opacity or zoom. */
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

/** Picks a single file or folder, e.g. the download location. */
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
    <div className="grid w-[240px] min-w-0 max-w-full justify-items-end gap-2">
      <span
        className={cn(
          "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-right text-[15px]",
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
    <span className="flex min-w-0 max-w-[360px] items-center justify-end gap-2">
      <span
        className={cn(
          "min-w-0 select-text overflow-hidden text-ellipsis whitespace-nowrap text-right text-[15px]",
          props.disabled ? "text-cream-muted" : "text-cream",
        )}
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
