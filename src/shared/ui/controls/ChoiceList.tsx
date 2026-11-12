import { Check } from "lucide-react";
import { cn } from "../classNames";
import { Text } from "../display/Text";
import { Pressable } from "./Pressable";

export type ChoiceRowProps = {
  selected: boolean;
  /** One of several that can be picked together: the row is a checkbox, not a radio. */
  multiple?: boolean;
  label: string;
  /** One muted line about the choice, up to two lines before it fades. */
  description?: string;
  /** The number key that picks it, announced as its shortcut. */
  shortcut?: number;
  disabled?: boolean;
  onSelect(): void;
};

/**
 * One answer to choose: its words, a line about it, and a checkmark at the right once chosen.
 * Rows live in a ChoiceList, which gives them their group and hairlines.
 */
export function ChoiceRow({
  selected,
  multiple,
  label,
  description,
  shortcut,
  disabled,
  onSelect,
}: ChoiceRowProps) {
  return (
    <Pressable
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      aria-keyshortcuts={shortcut ? String(shortcut) : undefined}
      disabled={disabled}
      data-slot="choice-row"
      className="flex min-h-8 w-full items-center gap-2 px-1 py-1.5 text-left hover:bg-control-hover"
      onClick={onSelect}
    >
      <span className="grid min-w-0 flex-1">
        <Text size="control" full>
          {label}
        </Text>
        {description ? (
          <Text size="meta" tone="muted" lines={2} full>
            {description}
          </Text>
        ) : null}
      </span>
      {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
    </Pressable>
  );
}

export type ChoiceListOption = {
  /** What is picked; defaults to the label. */
  value?: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type ChoiceListProps = {
  /** What is being chosen, for screen readers: usually the question itself. */
  label: string;
  options: ReadonlyArray<ChoiceListOption>;
  /** The picked values. One at most unless `multiple`. */
  selected: ReadonlyArray<string>;
  /** Called with the value of the row chosen; the caller toggles or replaces. */
  onSelect(value: string): void;
  /** Several may be picked: the rows are checkboxes. */
  multiple?: boolean;
  /** Announces 1–9 as each row's shortcut. The caller handles the keys. */
  shortcuts?: boolean;
  disabled?: boolean;
  /** Layout only: margins or placement. */
  className?: string;
};

/**
 * A vertical list of choices split by hairlines, with a checkmark on each picked row: one pick
 * (a radio group) or several (`multiple`). For questions an agent asks, quiz answers and other
 * pick-from-these lists whose rows carry a line of description. Short sets of mutually exclusive
 * options in a bar use ChoiceGroup instead.
 *
 * ```tsx
 * <ChoiceList label={question.text} multiple={question.multiSelect}
 *   options={question.options} selected={picked} onSelect={toggle} shortcuts />
 * ```
 */
export function ChoiceList({
  label,
  options,
  selected,
  onSelect,
  multiple = false,
  shortcuts = false,
  disabled = false,
  className,
}: ChoiceListProps) {
  return (
    <div
      role={multiple ? "group" : "radiogroup"}
      aria-label={label}
      data-slot="choice-list"
      className={cn("grid divide-y divide-charcoal-border", className)}
    >
      {options.map((option, index) => {
        const value = option.value ?? option.label;
        return (
          <ChoiceRow
            key={value}
            multiple={multiple}
            selected={selected.includes(value)}
            label={option.label}
            description={option.description}
            shortcut={shortcuts && index < 9 ? index + 1 : undefined}
            disabled={disabled || option.disabled}
            onSelect={() => onSelect(value)}
          />
        );
      })}
    </div>
  );
}
