import type { AppThemeMode } from "@/features/settings";

/** A tiny window in one theme: title bar, rail, tab strip and a page. Fixed grays, not theme tokens. */
const windowTones = {
  light: { frame: "#f4f4f5", rail: "#e4e4e7", bar: "#d4d4d8", page: "#ffffff", line: "#d4d4d8" },
  dark: { frame: "#18181b", rail: "#27272a", bar: "#3f3f46", page: "#202023", line: "#3f3f46" },
};

function MiniWindow(props: { tone: "light" | "dark" }) {
  const tone = windowTones[props.tone];
  return (
    <div className="absolute inset-0 flex" style={{ background: tone.frame }}>
      <div className="w-[14%]" style={{ background: tone.rail }} />
      <div className="flex flex-1 flex-col gap-[6%] p-[6%]">
        <div className="h-[10%] w-1/2 rounded-sm" style={{ background: tone.bar }} />
        <div className="flex-1 rounded-sm" style={{ background: tone.page }}>
          <div
            className="mx-[10%] mt-[12%] h-[8%] w-1/3 rounded-sm"
            style={{ background: tone.line }}
          />
          <div
            className="mx-[10%] mt-[6%] h-[8%] w-2/3 rounded-sm"
            style={{ background: tone.line }}
          />
        </div>
      </div>
    </div>
  );
}

export function ThemePreview(props: { mode: AppThemeMode }) {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-charcoal-border">
      {props.mode === "system" ? (
        <>
          <MiniWindow tone="light" />
          <div
            className="absolute inset-0"
            style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
          >
            <MiniWindow tone="dark" />
          </div>
        </>
      ) : (
        <MiniWindow tone={props.mode} />
      )}
    </div>
  );
}
