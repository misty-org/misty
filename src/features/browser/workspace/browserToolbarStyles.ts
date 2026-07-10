import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { cn } from "@/shared/ui/utils";

/** Shared geometry for native and SDK browser chrome. Keep touch targets full size. */
export const browserToolbarStyles = {
  bar: "relative z-10 flex h-11 shrink-0 items-center gap-1 border-b px-2",
  group: "flex shrink-0 items-center gap-1",
  // Circular glyphs need a smaller optical size beside arrows and line icons.
  roundIcon: { size: 14, className: "size-3.5", strokeWidth: 1.75, "aria-hidden": true } as const,
  icon: { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const,
};

export function browserToolbarButtonClass(light = false): string {
  return cn(
    "grid shrink-0 place-items-center rounded-md border-0 bg-transparent p-0",
    isNativeMobileBuild ? "size-11" : "size-[30px]",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none",
    light
      ? "text-[#6d6d6d] hover:bg-black/[0.045] hover:text-[#222] aria-pressed:bg-black/[0.06] focus-visible:ring-black/15 disabled:text-[#b9b9b9]"
      : "text-[#8f8f8f] hover:bg-white/[0.045] hover:text-[#dddddd] aria-pressed:bg-white/[0.06] focus-visible:ring-white/15 disabled:text-[#4e4e4e]",
  );
}
