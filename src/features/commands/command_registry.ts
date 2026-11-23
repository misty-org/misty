// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useSyncExternalStore } from "react";

export interface CommandDef {
  id: string;
  title: () => string;
  keywords?: () => string[];
  shortcutId?: string;
  available?: () => boolean;
  run: () => void;
}

export class Registry<T extends { id: string }> {
  private entries = new Map<string, T>();
  private listeners = new Set<() => void>();
  private snapshot: readonly T[] = [];

  register(entry: T): () => void {
    this.entries.set(entry.id, entry);
    this.emit();
    let disposed = false;
    return () => {
      if (disposed || this.entries.get(entry.id) !== entry) return;
      disposed = true;
      this.entries.delete(entry.id);
      this.emit();
    };
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  getSnapshot = (): readonly T[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}

export function useRegistry<T extends { id: string }>(registry: Registry<T>): readonly T[] {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot);
}

export const commandRegistry = new Registry<CommandDef>();
