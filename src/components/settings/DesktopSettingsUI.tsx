import type { ReactNode } from "react";

export const desktopSettingsGridClass =
  "grid h-screen min-h-0 min-w-0 grid-cols-[180px_1px_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-shell-bg,#050607)] text-[#f4f4f5] max-[980px]:grid-cols-[150px_1px_minmax(720px,1fr)] max-[980px]:overflow-x-auto max-[980px]:overflow-y-hidden";

export const desktopSettingsSidebarClass =
  "flex min-h-0 flex-col gap-[5px] bg-[var(--misty-app-nav-bg,var(--misty-app-shell-bg,#050607))] p-5 max-[980px]:px-2.5 max-[980px]:py-4";

export const desktopSettingsNavItemClass =
  "grid h-9 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-3 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left text-[15px] text-[#a1a1aa] hover:border-white/10 hover:bg-white/[0.045] hover:text-[#f4f4f5]";

export const desktopSettingsNavItemSelectedClass =
  "border-white/15 bg-[#f4f4f5] text-[#07090b] hover:bg-white hover:text-[#07090b]";

export const desktopSettingsContentClass =
  "misty-scrollbar min-h-0 min-w-0 overflow-auto bg-[var(--misty-app-shell-bg,#050607)] px-7 py-6";

export const desktopSettingsScrollSurfaceClass = "w-[min(100%,934px)] min-w-[720px]";

export const desktopSettingsOverlayGridClass =
  "grid h-full min-h-0 min-w-0 grid-cols-[214px_1px_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-shell-bg,#050607)] text-[#f4f4f5] max-[980px]:grid-cols-[180px_1px_minmax(620px,1fr)] max-[980px]:overflow-x-auto max-[980px]:overflow-y-hidden";

export const desktopSettingsOverlayContentShellClass =
  "grid min-h-0 min-w-0 grid-rows-[72px_minmax(0,1fr)] bg-[var(--misty-app-shell-bg,#050607)]";

export const desktopSettingsOverlayHeaderClass =
  "flex min-h-0 items-center justify-between gap-4 border-b border-white/10 px-7";

export const desktopSettingsOverlayContentClass =
  "misty-scrollbar min-h-0 min-w-0 overflow-auto bg-[var(--misty-app-shell-bg,#050607)] px-7 py-5";

export const desktopSettingsOverlayScrollSurfaceClass =
  "w-[min(100%,720px)] min-w-[560px]";

export const desktopSettingsOverlayCloseClass =
  "grid size-8 place-items-center rounded-md border border-transparent bg-transparent p-0 text-[#a1a1aa] transition hover:border-white/10 hover:bg-white/[0.045] hover:text-[#f4f4f5]";

export function DesktopSettingsSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3.5 overflow-hidden rounded-lg border border-white/10 bg-[var(--misty-app-surface-bg,#090b0d)] shadow-[0_1px_0_rgba(255,255,255,0.035)_inset]">
      <h2 className="border-b border-white/[0.08] bg-[rgba(12,14,16,var(--misty-app-panel-opacity,1))] px-7 py-4 text-[11px] font-[760] leading-none tracking-normal text-[#a1a1aa]">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export function DesktopSettingsRow(props: {
  label: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`grid min-h-[68px] grid-cols-[minmax(0,0.52fr)_minmax(260px,0.48fr)] items-center gap-[18px] border-b border-white/[0.08] bg-[var(--misty-app-surface-bg,#090b0d)] px-7 py-3 ${props.last ? "border-b-0" : ""} ${props.muted ? "opacity-45" : ""}`}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="text-[15px] font-[620] leading-[1.1] text-[#f4f4f5]">
          {props.label}
        </strong>
        {props.description ? (
          <span className="text-[14px] leading-[1.25] text-[#8f8f8f]">
            {props.description}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end overflow-hidden">
        {props.children}
      </div>
    </div>
  );
}
