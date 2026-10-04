import { Compare } from "./Compare";
import { cams, cursorVisible, frameExtras, moves, placements, type Placement } from "./director";
import { local, worldResolver } from "./measure";
import { camAt, cursorAt, type Cam } from "./motion";
import { CalloutTag, Cursor, Label, Logo, toScreen } from "./Overlays";
import { HEIGHT, ramp, WIDTH } from "./time";
import { Viewport, World } from "./World";

/** Close-ups never look past the edge of the window they are framing. */
function keepInside(cam: Cam, list: Placement[]): Cam {
  const place =
    list.find((p) => cam.x >= p.x && cam.x <= p.x + p.w && cam.y >= p.y && cam.y <= p.y + p.h) ?? list[0];
  const fit = (center: number, start: number, size: number, view: number) => {
    const half = view / 2 / cam.zoom;
    return size * cam.zoom >= view ? Math.min(Math.max(center, start + half), start + size - half) : center;
  };
  return { ...cam, x: fit(cam.x, place.x, place.w, WIDTH), y: fit(cam.y, place.y, place.h, HEIGHT) };
}

/** One frame of the film, a pure function of time. */
export function Film({ t }: { t: number }) {
  const list = placements(t);
  const resolve = worldResolver(list);
  const cam = keepInside(camAt(cams, t, resolve), list);
  const extras = frameExtras(t);
  const cursor = cursorVisible(t) ? cursorAt(moves, t, resolve) : null;
  return (
    <div className="film-frame relative overflow-hidden bg-[#050505]" style={{ width: WIDTH, height: HEIGHT }}>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, #1a1a1a 0%, #0b0b0b 55%, #050505 100%)" }}
      />
      <Viewport cam={cam} width={WIDTH} height={HEIGHT}>
        <World placements={list} bezels={extras.bezels} />
      </Viewport>
      {extras.callouts.map((callout) => {
        const place = list.find((p) => p.id === callout.target.split(":")[0]);
        const point = local(callout.target, callout.at, { x: 1, y: 0.5 });
        const world = { x: (place?.x ?? 0) + point.x, y: (place?.y ?? 0) + point.y };
        return <CalloutTag key={callout.text} callout={callout} point={toScreen(world, cam)} />;
      })}
      {extras.compare > 0 && <Compare t={t} opacity={extras.compare} />}
      <Label t={t} />
      {cursor && <Cursor frame={cursor} cam={cam} />}
      <div className="absolute inset-0 bg-[#050505]" style={{ opacity: Math.max(1 - ramp(t, 3.3, 1.0), extras.blackout) }} />
      <Logo opacity={extras.logoIntro} subtitle="Browser · Spaces · Files · Agents · Sync" subtitleOpacity={ramp(t, 1.3, 0.8)} />
      <Logo opacity={extras.logoClose} subtitle="Try the beta" subtitleOpacity={ramp(t, 85.5, 0.8)} />
    </div>
  );
}
