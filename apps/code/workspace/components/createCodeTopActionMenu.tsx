import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/ui";
import type { ComponentType } from "react";
import type { CodeTopAction } from "./CodeCommandCenter";

export function createCodeTopActionMenu(ShortcutHint: ComponentType<{ commandId: string }>) {
  return function CodeTopActionMenu({ action }: { action: CodeTopAction }) {
    const menu = action.menu!;
    return (
      <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={action.label}
            title={action.label}
            disabled={action.disabled}
            className="text-cream-muted"
          >
            {action.icon}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[50vh] min-w-72 overflow-y-auto">
          <DropdownMenuLabel>{menu.label}</DropdownMenuLabel>
          {menu.items.length ? (
            menu.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => {
                  menu.onOpenChange(false);
                  item.run();
                }}
              >
                <span className="min-w-0 flex-1 truncate whitespace-pre">{item.label}</span>
                {item.shortcutCommandId ? (
                  <ShortcutHint commandId={item.shortcutCommandId} />
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <p className="px-2 py-4 text-center text-xs text-mist-gray">{menu.emptyLabel}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
}
