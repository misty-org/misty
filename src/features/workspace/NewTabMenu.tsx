import { Plus, type LucideIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui";

export interface NewTabMenuOption {
  id: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

export function NewTabMenu(props: { ariaLabel: string; options: ReadonlyArray<NewTabMenuOption> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="size-7 rounded-full border-0 bg-transparent p-0 text-cream-muted hover:text-cream-bright"
          title={props.ariaLabel}
          aria-label={props.ariaLabel}
        >
          <Plus size={15} strokeWidth={2.4} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {props.options.map(({ id, icon: Icon, label, onSelect }) => (
          <DropdownMenuItem key={id} className="h-9 gap-2" onSelect={onSelect}>
            <Icon className="size-4" strokeWidth={1.8} />
            <span className="text-sm font-medium">{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
