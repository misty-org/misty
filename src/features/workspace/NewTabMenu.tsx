import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
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
          <MenuItem
            icon={<Icon className="size-4" strokeWidth={1.8} />}
            label={label}
            key={id}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
