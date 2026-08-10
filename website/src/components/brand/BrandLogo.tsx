import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-7 shrink-0", className)}
    >
      <img
        src="/misty-black.png"
        alt=""
        className="size-full object-contain dark:hidden"
      />
      <img
        src="/misty-white.png"
        alt=""
        className="hidden size-full object-contain dark:block"
      />
    </span>
  );
}
