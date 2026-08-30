import type { ReactNode } from "react";

import {
  productScreenshotSlots,
  type ProductScreenshotSlotId,
} from "@/content/productScreenshotSlots";
import { cn } from "@/lib/utils";
import { ProductCapture } from "./ProductCapture";

export function ScreenshotSlot({
  slot,
  children,
  eager = false,
  fill = false,
  className,
  captureClassName,
  imageClassName,
}: {
  slot: ProductScreenshotSlotId;
  children: ReactNode;
  eager?: boolean;
  fill?: boolean;
  className?: string;
  captureClassName?: string;
  imageClassName?: string;
}) {
  const screenshot = productScreenshotSlots[slot];
  const hasCapture = Boolean(screenshot.src);

  return (
    <div
      className={cn(fill && "h-full min-h-0", className)}
      data-screenshot-slot={slot}
      data-screenshot-status={hasCapture ? "capture" : "placeholder"}
      data-screenshot-filename={screenshot.filename}
    >
      {screenshot.src ? (
        <ProductCapture
          src={screenshot.src}
          alt={screenshot.alt}
          width={screenshot.width}
          height={screenshot.height}
          eager={eager}
          fill={fill}
          className={captureClassName}
          imageClassName={imageClassName}
        />
      ) : (
        children
      )}
    </div>
  );
}
