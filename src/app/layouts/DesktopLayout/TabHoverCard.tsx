/**
 * Tabs carry only their native title, the operating system's small tooltip. This keeps the
 * strip's hover wiring in one place without drawing a card: `bind` adds no handlers.
 */
export function useTabHoverCards() {
  const bind = (..._args: unknown[]) => ({});
  return { bind, card: null };
}
