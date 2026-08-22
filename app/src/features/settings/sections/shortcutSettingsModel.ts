import {
  normalizeShortcut,
  scopesOverlap,
  type ShortcutCommandDefinition,
  type ShortcutSlot,
} from "@/features/shortcuts";
import type { ShortcutBindingSet } from "@/native/contracts";

interface ConflictTarget {
  commandId: string;
  slot: ShortcutSlot;
}

export function findShortcutConflict(
  target: ConflictTarget,
  value: string,
  definitions: ShortcutCommandDefinition[],
  bindings: Map<string, ShortcutBindingSet>,
) {
  const targetDefinition = definitions.find((definition) => definition.id === target.commandId);
  if (!targetDefinition) return null;
  const normalized = normalizeShortcut(value);
  for (const definition of definitions) {
    const binding = bindings.get(definition.id);
    if (!binding) continue;
    for (const slot of ["primary", "alternate"] as const) {
      if (definition.id === target.commandId && slot === target.slot) continue;
      if (normalizeShortcut(binding[slot]) !== normalized) continue;
      if (!scopesOverlap(targetDefinition.scope, definition.scope)) continue;
      const contextualShadow =
        targetDefinition.scope !== definition.scope &&
        (targetDefinition.allowShadowing || definition.allowShadowing);
      if (contextualShadow) continue;
      return {
        commandId: definition.id,
        slot,
        label: definition.label,
        scope: shortcutScopeLabel(definition.scope),
      };
    }
  }
  return null;
}

export function groupShortcutsByCategory<T extends { category: string }>(
  items: T[],
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  return [...groups.entries()];
}

export function shortcutScopeLabel(scope: string): string {
  if (scope === "global") return "Everywhere";
  if (scope === "workspace") return "Workspace";
  return scope.slice(5).replace(/^./, (character) => character.toUpperCase());
}

export function shortcutCategorySlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
