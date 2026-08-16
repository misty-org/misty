import { Check, Laptop, Monitor } from "lucide-react";
import { devices } from "../data/project";
import { DESKTOP, LAPTOP } from "../scenes/common";
import { desktopSync, laptopSync } from "../scenes/sync";
import { AppWindow } from "../shell/AppWindow";
import { compareCams, compareChips, FROZEN } from "./director";
import { local } from "./measure";
import { camAt } from "./motion";
import { rise } from "./time";
import { Viewport } from "./World";

const PANEL = { w: 860, h: 640, top: 172 };

function Panel(props: { side: "desktop" | "laptop"; t: number; left: number }) {
  const desktop = props.side === "desktop";
  const size = desktop ? DESKTOP : LAPTOP;
  const state = desktop ? desktopSync(FROZEN) : laptopSync(props.t);
  const cam = camAt(compareCams[props.side], props.t, (target, at, anchor) => local(target, at, anchor));
  const Icon = desktop ? Monitor : Laptop;
  return (
    <div className="absolute" style={{ left: props.left, top: PANEL.top - 64, width: PANEL.w }}>
      <p className="flex h-12 items-center gap-3 text-[26px] font-medium text-cream-bright">
        <Icon className="size-7 text-cream-muted" aria-hidden />
        {desktop ? devices.desktop : devices.laptop}
        <span className="ml-auto text-[19px] font-normal text-cream-muted">{desktop ? "Before" : "After opening"}</span>
      </p>
      <div className="relative mt-4 overflow-hidden rounded-[18px] bg-[#0d0d0d] ring-1 ring-white/10" style={{ height: PANEL.h }}>
        <Viewport cam={cam} width={PANEL.w} height={PANEL.h}>
          <AppWindow state={{ ...state, sync: undefined }} width={size.w} height={size.h} windowId={`compare-${props.side}`} />
        </Viewport>
      </div>
    </div>
  );
}

/** Side by side: the desktop as it was left and the laptop after opening it. */
export function Compare({ t, opacity }: { t: number; opacity: number }) {
  return (
    <div className="absolute inset-0 bg-[#080808]" style={{ opacity }}>
      <Panel side="desktop" t={t} left={80} />
      <Panel side="laptop" t={t} left={980} />
      <div className="absolute inset-x-0 flex justify-center gap-4" style={{ top: PANEL.top + PANEL.h + 54 }}>
        {compareChips.map((chip) => {
          const shown = rise(t, chip.at, 0.35);
          return (
            <span
              key={chip.label}
              className="flex h-14 items-center gap-3 rounded-full border border-[#333] px-6 text-[23px] text-cream-bright"
              style={{ opacity: shown, transform: `translateY(${(1 - shown) * 10}px)` }}
            >
              <Check className="size-6" aria-hidden />
              {chip.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
