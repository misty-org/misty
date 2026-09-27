import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { Plus, type LucideIcon } from "lucide-react";

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
        <IconButton shape="round" label={props.ariaLabel} tooltip={false}>
          <Plus size={15} strokeWidth={2.4} />
        </IconButton>
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
