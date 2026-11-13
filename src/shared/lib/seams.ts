/**
 * A seam between two features. The lower feature declares it and calls it; the upper feature (or
 * the app, once at startup) fills it in. Features then never import each other in both directions.
 */
export function createPort<T>(name: string) {
  let implementation: T | undefined;
  return {
    provide(value: T): void {
      implementation = value;
    },
    get(): T {
      if (implementation === undefined) throw new Error(`${name} was not provided`);
      return implementation;
    },
    maybe(): T | undefined {
      return implementation;
    },
  };
}

/** Listeners a lower feature runs at a moment it owns; upper features subscribe to it. */
export function createHooks<Args extends unknown[] = []>() {
  const listeners = new Set<(...args: Args) => void | Promise<void>>();
  return {
    listen(listener: (...args: Args) => void | Promise<void>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run(...args: Args): void {
      for (const listener of listeners) void listener(...args);
    },
    async runAsync(...args: Args): Promise<void> {
      for (const listener of listeners) await listener(...args);
    },
  };
}
