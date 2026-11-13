import { Info, type LucideIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import {
  Popover,
  PopoverActions,
  PopoverContent,
  PopoverHeader,
  PopoverText,
  PopoverTrigger,
} from "./Popover";

/**
 * A quiet "i" about a surface, last in its BottomBar (the window's, a popup's or an overlay's),
 * and the small panel it opens: a title, a line, and one action. It never floats over content.
 */
export function InfoCorner(props: {
  /** The button's tooltip and accessible name. */
  label: string;
  title: string;
  body: string;
  action: { label: string; icon?: LucideIcon; onSelect(): void };
}) {
  const [open, setOpen] = React.useState(false);
  const Icon = props.action.icon;
  return (
    <div data-slot="info-corner" className="flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton label={props.label} tooltipSide="left">
            <Info />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={8} size="sm">
          <PopoverHeader title={props.title} />
          <PopoverText>{props.body}</PopoverText>
          <PopoverActions>
            <Button
              variant="secondary"
              icon={Icon}
              onClick={() => {
                setOpen(false);
                props.action.onSelect();
              }}
            >
              {props.action.label}
            </Button>
          </PopoverActions>
        </PopoverContent>
      </Popover>
    </div>
  );
}
