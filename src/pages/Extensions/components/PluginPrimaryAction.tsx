import { Button } from "@/ui/button";
import type { PluginBrowserEntry } from "./types";
import { actionLabel } from "./helpers";

export type PluginActionHandlers = {
  onInstall?: (plugin: PluginBrowserEntry) => void;
  onToggle?: (plugin: PluginBrowserEntry, enabled: boolean) => void;
  onPrimaryAction?: (plugin: PluginBrowserEntry) => void;
  primaryActionLabel?: string;
};

export function PluginPrimaryAction({
  plugin,
  busy,
  className,
  size,
  onInstall,
  onToggle,
  onPrimaryAction,
  primaryActionLabel,
}: PluginActionHandlers & {
  plugin: PluginBrowserEntry;
  busy: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <Button
      className={className}
      disabled={
        busy ||
        (!plugin.installed && !onInstall) ||
        (plugin.installed && !plugin.enabled && !onToggle) ||
        (plugin.installed && plugin.enabled && !onPrimaryAction)
      }
      onClick={() => {
        if (!plugin.installed) {
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
