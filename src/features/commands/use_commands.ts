import { registerBuiltinCommands } from "./builtins";
import { commandRegistry, useRegistry, type CommandDef } from "./command_registry";

let builtinsRegistered = false;

export function useCommands(): readonly CommandDef[] {
  if (!builtinsRegistered) {
    builtinsRegistered = true;
    registerBuiltinCommands();
  }
  return useRegistry(commandRegistry);
}
