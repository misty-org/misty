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
import { ModelProviderIcon } from "./ModelProviderIcon";

/** The display name for a model ID, from the catalog when it lists it. */
function modelName(options: SenseModel[], id: string) {
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
  chevron = true,
  showDefaultName = false,
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
  /** False drops the trigger's trailing chevron, as in a strip of chips. */
  chevron?: boolean;
  /** Name the model a default follows on the trigger, instead of the default's own name. */
  showDefaultName?: boolean;
  onChange(model: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [more, setMore] = useState(false);
  // Models outside each lab's current lineup stay behind "More models"; searching looks through them too.
  const showMore = more || query.trim() !== "";
  const visible = options.filter((option) => !option.more || showMore);
  const hasMore = options.some((option) => option.more);
  const providers = [...new Set(visible.map((option) => option.provider))];
  const choose = (model: string) => {
    setOpen(false);
    if (model !== value) onChange(model);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setMore(false);
        }
      }}
    >
      <MenuTrigger
        kind="popover"
        label={label}
        icon={<ModelProviderIcon model={value || defaultModel} />}
        value={
          value
            ? modelName(options, value)
            : showDefaultName
              ? modelName(options, defaultModel)
              : defaultLabel
        }
        chevron={chevron}
        title={`Model: ${modelName(options, value || defaultModel)}`}
        disabled={disabled}
        className={className}
      />
      <PopoverContent align="start" className="w-80 p-0" aria-label={label}>
        <Command label={label}>
          <CommandInput
            autoFocus
            aria-label="Find a model"
            placeholder="Find a model…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="default" keywords={[defaultLabel]} onSelect={() => choose("")}>
                <ModelProviderIcon model={defaultModel} />
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
                {visible
                  .filter((option) => option.provider === provider)
                  .map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      keywords={[option.name, provider]}
                      disabled={option.paid_only}
                      onSelect={() => choose(option.id)}
                    >
                      <ModelProviderIcon model={option.id} />
                      <span className="min-w-0 flex-1 truncate">{option.name}</span>
                      {option.paid_only && (
                        <span className="shrink-0 text-xs text-cream-muted">Paid plans</span>
                      )}
                      {option.id === value && <Check aria-label="Selected" />}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
            {hasMore && !query.trim() && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="more-models" onSelect={() => setMore((current) => !current)}>
                    {more ? "Fewer models" : "More models"}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
