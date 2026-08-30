import { cn } from "@/lib/utils";

export function ProductCapture({
  src,
  alt,
  width,
  height,
  eager = false,
  fill = false,
  className,
  imageClassName,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  eager?: boolean;
  fill?: boolean;
  className?: string;
  imageClassName?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl bg-[#0f0f0f] ring-1 ring-white/[0.09]",
        fill && "h-full min-h-0",
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={cn(
          "block h-auto w-full",
          fill && "h-full object-cover",
          imageClassName,
        )}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
      />
    </figure>
  );
}
