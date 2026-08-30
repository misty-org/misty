import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import {
  productVideoSlots,
  type ProductVideoSlotId,
} from "@/content/productVideoSlots";
import { cn } from "@/lib/utils";

function ProductVideo({
  src,
  label,
  active,
  fill = false,
}: {
  src: string;
  label: string;
  active?: boolean;
  fill?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (active === false) {
      video.pause();
      return;
    }

    if (active === true) {
      void video.play().catch(() => undefined);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.45 },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [active]);

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl bg-[#0f0f0f] ring-1 ring-white/[0.09]",
        fill && "h-full min-h-0",
      )}
    >
      <video
        ref={videoRef}
        src={src}
        aria-label={label}
        className={cn(
          "block w-full object-cover",
          fill ? "h-full" : "aspect-[8/5]",
        )}
        muted
        loop
        playsInline
        preload="metadata"
      />
    </figure>
  );
}

export function VideoSlot({
  slot,
  active,
  children,
  className,
  fill = false,
}: {
  slot: ProductVideoSlotId;
  active?: boolean;
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  const video = productVideoSlots[slot];
  const hasCapture = Boolean(video.src);

  return (
    <div
      className={cn("min-w-0", fill && "h-full min-h-0", className)}
      data-video-slot={slot}
      data-video-status={hasCapture ? "capture" : "placeholder"}
      data-video-filename={video.filename}
    >
      {video.src ? (
        <ProductVideo
          src={video.src}
          label={video.label}
          active={active}
          fill={fill}
        />
      ) : (
        children
      )}
    </div>
  );
}
