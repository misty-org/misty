import * as React from "react";
import { cn } from "../classNames";
import type { MenuIcon } from "../overlays/MenuItem";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

/** One option: its 16px icon, its label, and the value it stands for. */
type SelectOption = {
  value: string;
  icon: MenuIcon;
  label: React.ReactNode;
  disabled?: boolean;
  /** Why a disabled option can't be picked, shown in a tooltip while it is hovered. */
  reason?: string;
};

type OptionSelectProps = {
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

// Radix Select reserves "" for "nothing selected", so an empty option gets a stand-in value.
const emptyValue = "__option_select_empty__";
const toItem = (value: string) => (value === "" ? emptyValue : value);
const fromItem = (value: string) => (value === emptyValue ? "" : value);

/**
 * A Select built from a plain options list; the shared replacement for a native <select>.
 *
 * ```tsx
 * <OptionSelect
 *   aria-label="Layout"
 *   value={layout}
 *   onValueChange={setLayout}
 *   options={[
 *     { value: "list", label: "List", icon: List },
 *     { value: "grid", label: "Grid", icon: LayoutGrid },
 *   ]}
 * />
 * ```
 */
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
        aria-invalid={props["aria-invalid"] || undefined}
        className={cn("w-full", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={toItem(option.value)}
            disabled={option.disabled}
            reason={option.reason}
            icon={option.icon}
            label={option.label}
          />
        ))}
      </SelectContent>
    </Select>
  );
}

export { OptionSelect };
export type { SelectOption };
