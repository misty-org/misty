/**
 * Text that always fits: a slot's text steps down from its largest size until it fits its box.
 * If it still overflows at its smallest size, it is marked, never left to spill silently.
 */

export interface FitResult {
  size: number;
  overflow: boolean;
}

/** The sizes tried, largest first: about 6% apart, ending on the smallest. */
export function fitSteps(max: number, min: number): number[] {
  const steps: number[] = [];
  let size = max;
  while (size > min) {
    steps.push(size);
    size = Math.floor(size * 0.94);
  }
  steps.push(min);
  return steps;
}

/** Walks the sizes until `fits` says yes. */
export function fitTextSize(fits: (size: number) => boolean, max: number, min: number): FitResult {
  for (const size of fitSteps(max, min)) if (fits(size)) return { size, overflow: false };
  return { size: min, overflow: true };
}

/**
 * Fits the text element `content` inside `box` by setting its font size directly, measured in
 * layout pixels (unaffected by the frame's scale). Leaves the chosen size set.
 */
export function fitElement(
  content: HTMLElement,
  box: HTMLElement,
  max: number,
  min: number,
): FitResult {
  const limit = box.clientHeight;
  // A box not laid out (jsdom, a hidden pane) can't be measured: take the largest size.
  if (!limit) {
    content.style.fontSize = `${max}px`;
    return { size: max, overflow: false };
  }
  const result = fitTextSize(
    (size) => {
      content.style.fontSize = `${size}px`;
      return content.offsetHeight <= limit + 1 && content.scrollWidth <= box.clientWidth + 1;
    },
    max,
    min,
  );
  content.style.fontSize = `${result.size}px`;
  return result;
}
