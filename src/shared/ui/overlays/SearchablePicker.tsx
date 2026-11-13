import * as React from "react";
import type { ButtonIcon } from "../controls/Button";
import type { IconButtonProps } from "../controls/IconButton";
import { SkeletonList } from "../feedback/Skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./Command";
import type { MenuIcon } from "./MenuItem";
import { MenuTrigger } from "./MenuTrigger";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export interface SearchablePickerOption {
  /** The row's key, when two options share a value (a local and a remote branch). */
  id?: string;
  /** What `onPick` gets; the option whose value is the picker's `value` is checked. */
  value: string;
  label: string;
  /** The 16px icon, only when it tells options apart, e.g. a cloud for a remote branch. */
  icon?: MenuIcon;
  /** More words the search matches besides the label. */
  keywords?: ReadonlyArray<string>;
  disabled?: boolean;
  /** Why a disabled option can't be picked, in a tooltip. */
  reason?: string;
}

/** A row after the options, set apart by a separator, such as "New branch". */
export interface SearchablePickerAction {
  icon: MenuIcon;
  label: string;
  onSelect(): void;
}

export interface SearchablePickerProps {
  /** What is picked, e.g. "Branch": the trigger's name and tooltip and the list's name. */
  label: string;
  /** The trigger's 16px icon. */
  icon?: ButtonIcon;
  /** Undefined while the options are read: the list shows skeleton rows. */
  options: ReadonlyArray<SearchablePickerOption> | undefined;
  value: string | null | undefined;
  /** What the trigger says when nothing is picked. Defaults to `label`. */
  placeholder?: string;
  /** The search field's placeholder and name, e.g. "Search branches". */
  searchLabel: string;
  /** The one line shown when nothing matches, e.g. "No branches match". */
  emptyLabel: string;
  onPick(value: string): void;
  /** Told each time the list opens, e.g. to read the options again. */
  onOpen?(): void;
  actions?: ReadonlyArray<SearchablePickerAction>;
  /**
   * Opens the list from your own element instead of the default trigger, such as a path line's
   * segment. It must forward its ref and props to a button.
   */
  trigger?: React.ReactElement;
  side?: "top" | "bottom";
  align?: "start" | "end";
  /** The default trigger's size and look. */
  size?: IconButtonProps["size"];
  variant?: "quiet" | "secondary";
  /** Layout only, on the default trigger. */
  className?: string;
}

/**
 * A picker with a search field over its options: a trigger that shows the pick, and a list where
 * typing narrows the rows, the current one checked, actions after a separator. For lists long
 * enough to search (branches, folders, models); short fixed choices use OptionSelect.
 *
 * ```tsx
 * <SearchablePicker label="Branch" icon={GitBranch} value={current} onPick={checkout}
 *   options={branches?.map((b) => ({ value: b.name, label: b.name, icon: GitBranch }))}
 *   searchLabel="Search branches" emptyLabel="No branches match" />
 * ```
 */
export function SearchablePicker(props: SearchablePickerProps) {
  const [open, setOpen] = React.useState(false);
  const picked = props.options?.find((option) => option.value === props.value);
  const close = (then: () => void) => {
    setOpen(false);
    then();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) props.onOpen?.();
      }}
    >
      {props.trigger ? (
        <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      ) : (
        <MenuTrigger
          kind="popover"
          label={props.label}
          icon={props.icon}
          value={picked?.label || props.value || props.placeholder || props.label}
          size={props.size}
          variant={props.variant}
          className={props.className}
        />
      )}
      <PopoverContent align={props.align ?? "start"} side={props.side} className="w-72 p-0">
        <Command label={props.label}>
          <CommandInput placeholder={props.searchLabel} aria-label={props.searchLabel} />
          <CommandList>
            {props.options === undefined ? (
              <SkeletonList label={props.label} rows={3} className="p-1" />
            ) : (
              <>
                <CommandEmpty>{props.emptyLabel}</CommandEmpty>
                <CommandGroup>
                  {props.options.map((option) => {
                    const id = option.id ?? option.value;
                    return (
                      <CommandItem
                        key={id}
                        value={id}
                        keywords={[option.label, ...(option.keywords ?? [])]}
                        icon={option.icon}
                        label={option.label}
                        checked={option.value === props.value}
                        disabled={option.disabled}
                        reason={option.reason}
                        onSelect={() => close(() => props.onPick(option.value))}
                      />
                    );
                  })}
                </CommandGroup>
              </>
            )}
            {props.actions?.length ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  {props.actions.map((action) => (
                    <CommandItem
                      key={action.label}
                      value={`action:${action.label}`}
                      icon={action.icon}
                      label={action.label}
                      onSelect={() => close(action.onSelect)}
                    />
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
