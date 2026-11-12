import { Button, cn, Input, OverflowFadeText, Textarea, Tooltip } from "@/shared/ui";
import { open } from "@tauri-apps/plugin-dialog";
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
  /** A native question of the control's own, for a choice that has to come from the person. */
  choose?: () => Promise<string | null>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);

  const chooseFile = async () => {
    setChoosing(true);
    try {
      const selected = props.choose
        ? await props.choose()
        : await open({
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
      <OverflowFadeText
        full
        className={cn(
          "max-w-full text-right text-md",
          props.disabled || !props.value ? "text-cream-muted" : "text-cream",
        )}
      >
        {props.value || props.emptyLabel || "None"}
      </OverflowFadeText>
      <div className="flex items-center gap-2">
        <Tooltip content={props.title}>
          <Button
            variant="secondary"
            type="button"
            className={settingsControlButtonCompactClass}
            disabled={props.disabled || choosing}
            onClick={() => void chooseFile()}
          >
            {choosing ? "Choosing…" : "Choose"}
          </Button>
        </Tooltip>
        <Button
          variant="secondary"
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
