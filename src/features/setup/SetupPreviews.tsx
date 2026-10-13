import type { DockingLayout, DockPosition } from "@/features/app-shell/dockingLayout";
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

const side = (position: DockPosition) => position === "left" || position === "right";

/** Where navigation and tabs sit. On the same edge, tabs sit inside navigation, as in the app. */
export function LayoutPreview(props: { layout: DockingLayout }) {
  const { navigation, tabs } = props.layout;
  const railSize = side(navigation) ? "14%" : "16%";
  const tabSize = side(tabs) ? "22%" : "14%";
  const tabOffset = navigation === tabs ? railSize : "0%";
  const edge = (position: DockPosition, size: string, offset: string) =>
    side(position)
      ? { top: 0, bottom: 0, [position]: offset, width: size }
      : { left: 0, right: 0, [position]: offset, height: size };
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-charcoal-border bg-charcoal-bg">
      <div className="absolute bg-charcoal-hover" style={edge(navigation, railSize, "0%")} />
      <div
        className="absolute flex gap-[3px] p-[3px]"
        style={{
          ...edge(tabs, tabSize, tabOffset),
          flexDirection: side(tabs) ? "column" : "row",
          // A strip across the rail's edge starts where the rail ends.
          ...(side(tabs) !== side(navigation) ? { [navigation]: railSize } : {}),
        }}
      >
        {[0, 1, 2].map((tab) => (
          <div
            key={tab}
            className={
              tab === 0 ? "rounded-[2px] bg-cream-muted/45" : "rounded-[2px] bg-cream-muted/20"
            }
            style={side(tabs) ? { height: "12%" } : { width: "18%" }}
          />
        ))}
      </div>
    </div>
  );
}
