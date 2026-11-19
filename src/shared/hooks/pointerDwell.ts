/**
 * Tracks a drag resting on one item, for "pause over a tab to open it while still holding". Call
 * the returned function on every frame of the drag with the item under the pointer (or null);
 * `onDwell` runs once the pointer has stayed on the same item for `delay` ms. Leaving the item,
 * or a gap in the calls (the pointer left the list), starts the wait over.
 */
export function createDwell(delay = 550) {
  let id: string | null = null;
  let since = 0;
  let seen = 0;
  let fired = false;
  return (next: string | null, onDwell: (id: string) => void) => {
    const now = performance.now();
    if (next !== id || now - seen > 150) {
      id = next;
      since = now;
      fired = false;
    }
    seen = now;
    if (id && !fired && now - since >= delay) {
      fired = true;
      onDwell(id);
    }
  };
}
