import { registerBuiltinCommands } from "./builtins";
import { commandRegistry, useRegistry, type CommandDef } from "./commandRegistry";

let builtinsRegistered = false;

/** Every command that can run now, the shortcut registry's included; ⌘K search lists them. */
export function useCommands(): readonly CommandDef[] {
  if (!builtinsRegistered) {
    builtinsRegistered = true;
    registerBuiltinCommands();
  }
  return useRegistry(commandRegistry);
}
