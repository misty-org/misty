import * as React from "react";
import { cn } from "../utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

export type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean };

type OptionSelectProps = {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

// Radix Select reserves "" for "nothing selected", so an empty option gets a stand-in value.
const emptyValue = "__option_select_empty__";
const toItem = (value: string) => (value === "" ? emptyValue : value);
const fromItem = (value: string) => (value === emptyValue ? "" : value);

/** A Select built from a plain options list; the shared replacement for a native <select>. */
function OptionSelect({
  value,
  options,
  onValueChange,
  placeholder,
  className,
  ...props
}: OptionSelectProps) {
  return (
    <Select
      value={toItem(value)}
      disabled={props.disabled}
      onValueChange={(next) => onValueChange(fromItem(next))}
    >
      <SelectTrigger
        id={props.id}
        aria-label={props["aria-label"]}
        aria-describedby={props["aria-describedby"]}
        className={cn("w-full", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={toItem(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { OptionSelect };
