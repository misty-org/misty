import { cn } from "@/lib/utils";

const mistyLogoMask = 'url("/misty-white.png") center / contain no-repeat';

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-7 shrink-0", className)}
      data-misty-brand-logo="monochrome"
      style={{
        WebkitMask: mistyLogoMask,
        background: "currentColor",
        mask: mistyLogoMask,
      }}
    />
  );
}
