import type { ShortcutCommandDefinition, ShortcutScope } from "./types";

export interface CommandOptions {
  description: string;
  category: string;
  scope?: ShortcutScope;
  aliases?: string[];
  mac?: string | null;
  macAlternate?: string | null;
  windows?: string | null;
  windowsAlternate?: string | null;
  linux?: string | null;
  linuxAlternate?: string | null;
  allowInEditable?: boolean;
  repeatable?: boolean;
  nativeMenu?: boolean;
  allowShadowing?: boolean;
}

export function command(
  id: string,
  label: string,
  options: CommandOptions,
): ShortcutCommandDefinition {
  const windows = options.windows === undefined ? (options.mac ?? null) : options.windows;
  const linux = options.linux === undefined ? windows : options.linux;
  const windowsAlternate =
    options.windowsAlternate === undefined
      ? (options.macAlternate ?? null)
      : options.windowsAlternate;
  const linuxAlternate =
    options.linuxAlternate === undefined ? windowsAlternate : options.linuxAlternate;
  return {
    id,
    label,
    description: options.description,
    category: options.category,
    scope: options.scope ?? "global",
    aliases: options.aliases ?? [],
    defaults: {
      macos: { primary: options.mac ?? null, alternate: options.macAlternate ?? null },
      windows: { primary: windows, alternate: windowsAlternate },
      linux: { primary: linux, alternate: linuxAlternate },
    },
    allowInEditable: options.allowInEditable ?? false,
    repeatable: options.repeatable ?? false,
    nativeMenu: options.nativeMenu ?? false,
    allowShadowing: options.allowShadowing ?? false,
  };
}
