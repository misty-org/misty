// Splitting a clip follows OpenCut's SplitElementsCommand (vendor/opencut/src/commands/timeline/
// element/split-elements.ts, MIT): the source-side split point is snapped once and both halves
// derive from it, so the two halves always add up to the whole.
import { roundMediaTime, type MediaTime } from "@opencut/wasm";
import { splitAnimationsAtTime } from "@opencut/animation";
import { getSourceSpanAtClipTime } from "@opencut/retime";
import type { TimelineElement } from "@opencut/timeline";
import { isRetimableElement } from "@opencut/timeline";
import { generateUUID } from "@opencut/utils/id";

/** One clip as two at `at` (timeline ticks inside it), each with its own share of the source. */
export function splitElement(
  element: TimelineElement,
  at: number,
): [TimelineElement, TimelineElement] {
  const relative = at - element.startTime;
  const retime = isRetimableElement(element) ? element.retime : undefined;
  const leftSpan = roundMediaTime({
    time: getSourceSpanAtClipTime({ clipTime: relative as MediaTime, retime }),
  });
  const totalSpan = roundMediaTime({
    time: getSourceSpanAtClipTime({ clipTime: element.duration, retime }),
  });
  const { leftAnimations, rightAnimations } = splitAnimationsAtTime({
    animations: element.animations,
    splitTime: relative as MediaTime,
    shouldIncludeSplitBoundary: true,
  });
  const left = {
    ...element,
    duration: relative as MediaTime,
    trimEnd: (element.trimEnd + (totalSpan - leftSpan)) as MediaTime,
    animations: leftAnimations,
  } as TimelineElement;
  const right = {
    ...element,
    id: generateUUID(),
    startTime: at as MediaTime,
    duration: (element.duration - relative) as MediaTime,
    trimStart: (element.trimStart + leftSpan) as MediaTime,
    animations: rightAnimations,
  } as TimelineElement;
  return [left, right];
}
