import { cams, moves, scripts } from "./director";
import { clickTimes } from "./motion";
import { DURATION, scenes } from "./time";

/** Sound cues derived from the same timeline that drives the picture. */
export function cues() {
  const typing = scripts.flatMap((script) => script.typing);
  const keystrokes = typing.flatMap(({ start, chars, cps }) =>
    Array.from({ length: chars }, (_, index) => +(start + index / cps).toFixed(4)),
  );
  // Larger camera moves get a soft air movement; small reframes stay silent.
  const sweeps = cams
    .slice(1)
    .filter((key, index) => key.t - cams[index].t > 0.4 && Math.abs(Math.log(key.zoom / cams[index].zoom)) > 0.35)
    .map((key, index) => ({ start: cams[index].t, end: key.t }));
  return {
    duration: DURATION,
    scenes: scenes.map(({ id, start, end }) => ({ id, start, end })),
    clicks: clickTimes(moves),
    keystrokes,
    keys: scripts.flatMap((script) => script.keys ?? []),
    chimes: scripts.flatMap((script) => script.chimes),
    sweeps,
    handoff: { leave: 71.0, open: 74.45, restored: 77.15 },
  };
}
