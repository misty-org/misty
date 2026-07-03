import { Monitor } from "lucide-react";
import { mobilePageClass } from "../../shell/mobileStyles";

export function MobileDesktopRequiredPage(props: { feature: string }) {
  return (
    <section className={`${mobilePageClass} grid place-items-center`}>
      <div className="grid max-w-[360px] place-items-center gap-2.5 text-center text-[var(--misty-text)]">
        <Monitor size={34} strokeWidth={1.8} />
        <span className="text-[11px] font-[760] uppercase tracking-normal text-[var(--misty-text-subtle)]">Desktop only</span>
        <h2 className="m-0 text-2xl font-black leading-tight">{props.feature} is not available on mobile yet.</h2>
        <p className="m-0 max-w-[280px] text-sm leading-relaxed text-[var(--misty-text-muted)]">
          Misty mobile is intentionally simplified for v1. Use the desktop app for this workflow.
        </p>
      </div>
    </section>
  );
}
