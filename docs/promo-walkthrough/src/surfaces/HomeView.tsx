import { Clock, House } from "lucide-react";

/** Home, as the second computer shows it before the workspace is opened. */
export function HomeView({ device }: { device: "desktop" | "laptop" }) {
  return (
    <div className="h-full bg-[#101010] px-14 pt-10">
      <h1 className="text-[34px] font-semibold tracking-tight text-cream-bright">Good evening, Alex.</h1>
      <p className="mt-1 text-[15px] text-cream-muted">Thursday, October 2</p>
      <div className="mt-8 grid grid-cols-[1.6fr_1fr] gap-4">
        <div className="h-64 rounded-xl border border-charcoal-border" />
        <div className="h-64 rounded-xl border border-charcoal-border p-5 text-sm text-cream-muted">Today</div>
      </div>
      <div className="mt-4 rounded-xl border border-charcoal-border p-5">
        <p className="flex items-center gap-2 text-sm text-cream-muted">
          <Clock className="size-4" aria-hidden /> Recent
        </p>
        <p className="mt-4 flex items-center gap-3 text-[15px] text-cream">
          <House className="size-4 text-cream-muted" aria-hidden /> Home
          <span className="ml-auto text-sm text-cream-muted">{device === "laptop" ? "Active now" : ""}</span>
        </p>
      </div>
    </div>
  );
}
