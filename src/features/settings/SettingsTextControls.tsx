import { cn, Input, Textarea } from "@misty/ui";
import { type ChangeEvent } from "react";

import { settingsDisabledControlClass } from "./settings_constants";

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
      className={cn("w-60 max-w-full", settingsDisabledControlClass)}
      defaultValue={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onBlur={handleCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.currentTarget.value = props.value;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

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
      className={cn("w-full max-w-130", settingsDisabledControlClass)}
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
