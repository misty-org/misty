import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@/shared/ui";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { useMemo, useState } from "react";
import type { GatewayModel } from "../model/interfaces/personal";
import { selectedAgentModelName } from "../modelSelection";
import { ModelProviderLogo } from "./ModelProviderLogo";

export function AgentModelPicker({
  models,
  value,
  onValueChange,
  disabled = false,
  side = "bottom",
  align = "start",
  className,
}: {
  models: GatewayModel[];
  value: string;
  onValueChange: (modelId: string) => void;
  disabled?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => models.find((model) => model.id === value) ?? null,
    [models, value],
  );
  const label = selected?.name ?? selectedAgentModelName(value);

  const choose = (modelId: string) => {
    onValueChange(modelId);
    setOpen(false);
  };

  return (
    // The picker is portaled outside any parent dialog. Making it modal while
    // open prevents the dialog's scroll lock from swallowing list wheel events.
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          disabled={disabled}
          className={cn("h-9 min-w-0 justify-start gap-2 px-2.5 shadow-none", className)}
          aria-label={`Model: ${label}`}
          aria-expanded={open}
        >
          <Cpu size={15} className="shrink-0 text-cream-muted" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-cream-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(420px,calc(100vw-32px))] p-0"
        align={align}
        side={side}
        sideOffset={6}
      >
        <Command>
          <CommandInput placeholder={`Search ${models.length} Vercel AI models…`} />
          <CommandList className="max-h-[min(420px,calc(100vh-160px))]">
            <CommandEmpty>No matching model.</CommandEmpty>
            <CommandGroup heading={`Vercel AI Gateway · ${models.length} models`}>
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`${model.name} ${model.id} ${model.capabilities.join(" ")}`}
                  onSelect={() => choose(model.id)}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-charcoal-card">
                    <ModelProviderLogo modelId={model.id} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{model.name}</span>
                    <span className="block truncate text-xs text-cream-muted">{model.id}</span>
                  </span>
                  {value === model.id ? <Check size={14} /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
