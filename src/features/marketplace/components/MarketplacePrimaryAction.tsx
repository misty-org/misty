import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/ui/utils";
import { actionLabel } from "./helpers";
import type { MarketplaceEntry } from "./types";

export type MarketplaceActionHandlers = {
  onInstall?: (plugin: MarketplaceEntry) => void;
  onToggle?: (plugin: MarketplaceEntry, enabled: boolean) => void;
  onPrimaryAction?: (plugin: MarketplaceEntry) => void;
  primaryActionLabel?: string;
};

export function MarketplacePrimaryAction({
  plugin,
  busy,
  className,
  size,
  onInstall,
  onToggle,
  onPrimaryAction,
  primaryActionLabel,
}: MarketplaceActionHandlers & {
  plugin: MarketplaceEntry;
  busy: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <Button
      className={cn("max-[860px]:h-11", className)}
      disabled={
        busy ||
        (plugin.kind === "builtin"
          ? !onPrimaryAction
          : plugin.updateAvailable || !plugin.installed
            ? !onInstall
            : !plugin.enabled
              ? !onToggle
              : !onPrimaryAction)
      }
      onClick={() => {
        if (plugin.kind === "builtin") {
          onPrimaryAction?.(plugin);
          return;
        }
        if (!plugin.installed) {
          onInstall?.(plugin);
          return;
        }
        if (plugin.updateAvailable) {
          onInstall?.(plugin);
          return;
        }
        if (!plugin.enabled) {
          onToggle?.(plugin, true);
          return;
        }
        onPrimaryAction?.(plugin);
      }}
      size={size}
      type="button"
    >
      {plugin.installed && plugin.enabled && primaryActionLabel
        ? primaryActionLabel
        : actionLabel(plugin)}
    </Button>
  );
}
