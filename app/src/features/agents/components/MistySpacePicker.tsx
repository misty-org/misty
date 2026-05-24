import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Check, ChevronDown, PanelsTopLeft } from "lucide-react";

export function MistySpacePicker({
  spaces,
  activeSpaceId,
  disabled,
  onSelect,
}: {
  spaces: Space[];
  activeSpaceId: string;
  disabled?: boolean;
  onSelect: (spaceId: string) => void;
}) {
  const activeSpace = spaces.find((space) => space.id === activeSpaceId);
  const label = activeSpace?.name ?? "Choose Space";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || spaces.length === 0}
          className={cn(
            "h-8 min-w-0 max-w-52 justify-start gap-2 rounded-md border px-2.5 shadow-none",
            "border-charcoal-border/80 bg-charcoal-card/60 text-[11px] text-cream",
            "hover:border-cream-muted/35 hover:bg-charcoal-hover",
          )}
          aria-label={`Conversation Space: ${label}`}
        >
          <PanelsTopLeft size={14} className="shrink-0 text-cream-muted" />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown size={13} className="shrink-0 text-cream-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Work in Space</DropdownMenuLabel>
        {spaces.map((space) => (
          <DropdownMenuItem
            key={space.id}
            className="min-h-9 gap-2"
            onSelect={() => onSelect(space.id)}
          >
            <PanelsTopLeft size={14} className="shrink-0 text-cream-muted" />
            <span className="min-w-0 flex-1 truncate">{space.name}</span>
            {space.id === activeSpaceId ? <Check size={14} className="shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
        <p className="m-0 border-t border-charcoal-border/70 px-2 py-2 text-[10px] leading-4 text-cream-muted">
          Changing Space starts a new conversation so context never crosses boundaries.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
