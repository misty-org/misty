import type { ReactNode } from "react";
import { devices } from "../data/project";
import { AppWindow } from "../shell/AppWindow";
import type { Placement } from "./director";
import type { Cam } from "./motion";

/** A camera onto a world: `cam` is the world point at the viewport center. */
export function Viewport(props: { cam: Cam; width: number; height: number; children: ReactNode; className?: string }) {
  const { cam, width, height } = props;
  return (
    <div className={props.className} style={{ position: "absolute", inset: 0, width, height, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${width / 2 - cam.x * cam.zoom}px, ${height / 2 - cam.y * cam.zoom}px) scale(${cam.zoom})`,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

function Monitor({ p, opacity }: { p: Placement; opacity: number }) {
  const pad = 28;
  return (
    <div style={{ opacity }}>
      <div
        className="absolute rounded-[26px] border border-[#2c2c2c] bg-[#121212]"
        style={{ left: p.x - pad, top: p.y - pad, width: p.w + pad * 2, height: p.h + pad * 2 }}
      />
      <div className="absolute bg-[#1a1a1a]" style={{ left: p.x + p.w / 2 - 90, top: p.y + p.h + pad, width: 180, height: 150 }} />
      <div className="absolute rounded-[10px] bg-[#1e1e1e]" style={{ left: p.x + p.w / 2 - 230, top: p.y + p.h + pad + 150, width: 460, height: 22 }} />
      <p className="absolute text-center text-[44px] font-medium text-cream-muted" style={{ left: p.x, width: p.w, top: p.y + p.h + 250 }}>
        {devices.desktop}
      </p>
    </div>
  );
}

function Laptop({ p, opacity }: { p: Placement; opacity: number }) {
  const pad = 24;
  return (
    <div style={{ opacity }}>
      <div
        className="absolute rounded-t-[28px] border border-[#2c2c2c] bg-[#121212]"
        style={{ left: p.x - pad, top: p.y - pad, width: p.w + pad * 2, height: p.h + pad * 2 }}
      />
      <div
        className="absolute rounded-b-[26px] bg-[#1e1e1e]"
        style={{ left: p.x - 150, top: p.y + p.h + pad, width: p.w + 300, height: 30 }}
      />
      <p className="absolute text-center text-[44px] font-medium text-cream-muted" style={{ left: p.x, width: p.w, top: p.y + p.h + 110 }}>
        {devices.laptop}
      </p>
    </div>
  );
}

export function World({ placements, bezels }: { placements: Placement[]; bezels: number }) {
  return (
    <>
      {bezels > 0 &&
        placements.map((p) => (p.id === "desktop" ? <Monitor key={p.id} p={p} opacity={bezels} /> : <Laptop key={p.id} p={p} opacity={bezels} />))}
      {placements.map((p) => (
        <div key={p.id} className="absolute" style={{ left: p.x, top: p.y, opacity: p.opacity }}>
          <AppWindow state={p.state} width={p.w} height={p.h} />
          {p.dim > 0 && <div className="absolute inset-0 rounded-[12px] bg-black" style={{ opacity: p.dim }} />}
        </div>
      ))}
    </>
  );
}
