import { useEffect, useRef, type ReactNode } from "react";

/**
 * Where the photo and video editors draw: the page's content area, filling it, in place of what
 * opened them. They are pages, not popups. Escape goes to `onEscape` unless something inside
 * (a menu, a dialog, a field) handled it first.
 */
export function EditorPane(props: { name: string; onEscape: () => void; children: ReactNode }) {
  // Read through a ref so a new callback each render doesn't re-bind the key.
  const onEscape = useRef(props.onEscape);
  onEscape.current = props.onEscape;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onEscape.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <section
      aria-label={`Edit ${props.name}`}
      className="flex size-full min-h-0 min-w-0 flex-col bg-charcoal-workspace"
    >
      {props.children}
    </section>
  );
}
