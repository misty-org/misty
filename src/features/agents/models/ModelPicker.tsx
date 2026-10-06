import { Check } from "lucide-react";
import { useState } from "react";
import type { SenseModel } from "@/api/assistant/senses";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
} from "@/shared/ui";

/** The display name for a model ID, from the catalog when it lists it. */
export function modelName(options: SenseModel[], id: string) {
  return options.find((option) => option.id === id)?.name ?? id.slice(id.indexOf("/") + 1);
}

/**
 * Searchable Gateway model menu. The first entry follows a default (Misty's, or the
 * account's in a conversation); the rest are grouped by provider.
 */
export function ModelPicker({
  label,
  options,
  value,
  defaultModel,
  defaultLabel,
  disabled,
  className,
  onChange,
}: {
  /** Accessible name, e.g. "Thinking model". */
  label: string;
  options: SenseModel[];
  /** The chosen model; empty follows the default. */
  value: string;
  defaultModel: string;
  /** What following the default is called, e.g. "Misty default". */
  defaultLabel: string;
  disabled?: boolean;
  className?: string;
  onChange(model: string): void;
}) {
  const [open, setOpen] = useState(false);
  const providers = [...new Set(options.map((option) => option.provider))];
  const choose = (model: string) => {
    setOpen(false);
    if (model !== value) onChange(model);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MenuTrigger
        kind="popover"
        label={label}
        value={value ? modelName(options, value) : defaultLabel}
        disabled={disabled}
        className={className}
      />
      <PopoverContent align="start" className="w-80 p-0" aria-label={label}>
        <Command label={label}>
          <CommandInput autoFocus aria-label="Find a model" placeholder="Find a model…" />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="default" keywords={[defaultLabel]} onSelect={() => choose("")}>
                <span className="min-w-0 flex-1 truncate">{defaultLabel}</span>
                <span className="truncate text-xs text-cream-muted">
                  {modelName(options, defaultModel)}
                </span>
                {!value && <Check aria-label="Selected" />}
              </CommandItem>
            </CommandGroup>
            {providers.length > 0 && <CommandSeparator />}
            {providers.map((provider) => (
              <CommandGroup key={provider} heading={provider}>
                {options
                  .filter((option) => option.provider === provider)
                  .map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      keywords={[option.name, provider]}
                      onSelect={() => choose(option.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.name}</span>
                      {option.id === value && <Check aria-label="Selected" />}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
