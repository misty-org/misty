import { useEffect, useSyncExternalStore } from "react";
import type { Options } from "react-markdown";

type Plugin = NonNullable<Options["rehypePlugins"]>[number];

const math = {
  plugin: undefined as Plugin | undefined,
  loading: undefined as Promise<void> | undefined,
  listeners: new Set<() => void>(),
};

function loadMath() {
  math.loading ??= Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")])
    .then(([{ default: rehypeKatex }]) => {
      math.plugin = rehypeKatex;
      for (const listener of math.listeners) listener();
    })
    .catch(() => {
      math.loading = undefined;
    });
}

function subscribeMath(listener: () => void) {
  math.listeners.add(listener);
  return () => {
    math.listeners.delete(listener);
  };
}

export function useMathPlugin(text: string): Plugin | undefined {
  const needed = text.includes("$$");
  const plugin = useSyncExternalStore(subscribeMath, () => math.plugin);
  useEffect(() => {
    if (needed && !math.plugin) loadMath();
  }, [needed]);
  return needed ? plugin : undefined;
}
