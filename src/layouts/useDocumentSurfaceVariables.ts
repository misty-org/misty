import { useEffect, type CSSProperties } from "react";

export function useDocumentSurfaceVariables(surfaceStyle: CSSProperties) {
  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const variables = Object.entries(surfaceStyle).filter(([name]) => name.startsWith("--"));
    const previous = variables.map(
      ([name]) =>
        [name, rootStyle.getPropertyValue(name), rootStyle.getPropertyPriority(name)] as const,
    );
    variables.forEach(([name, value]) => rootStyle.setProperty(name, String(value)));
    return () =>
      previous.forEach(([name, value, priority]) =>
        value ? rootStyle.setProperty(name, value, priority) : rootStyle.removeProperty(name),
      );
  }, [surfaceStyle]);
}
