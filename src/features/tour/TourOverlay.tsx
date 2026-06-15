import { useEffect, useState } from "react";

export interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay(props: {
  targetSelector?: string;
  padding?: number;
  radius?: number;
}) {
  const { targetSelector, padding = 6, radius = 10 } = props;
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    if (!targetSelector) {
      setTargetRect(null);
      return;
    }

    const updateRect = () => {
      const el = document.querySelector<HTMLElement>(targetSelector);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setTargetRect(null);
      }
    };

    updateRect();
    const handleResize = () => updateRect();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    const observer = new MutationObserver(updateRect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
      observer.disconnect();
    };
  }, [targetSelector]);

  return (
    <>
      <svg
        className="fixed inset-0 z-[90] size-full pointer-events-none transition-opacity duration-200"
        aria-hidden="true"
      >
        <defs>
          <mask id="misty-tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - padding}
                y={targetRect.top - padding}
                width={targetRect.width + padding * 2}
                height={targetRect.height + padding * 2}
                rx={radius}
                ry={radius}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.72)"
          mask="url(#misty-tour-spotlight-mask)"
          className="pointer-events-auto"
        />
      </svg>

      {targetRect && (
        <div
          className="pointer-events-none fixed z-[95] transition-all duration-200"
          style={{
            top: targetRect.top - padding,
            left: targetRect.left - padding,
            width: targetRect.width + padding * 2,
            height: targetRect.height + padding * 2,
            borderRadius: `${radius}px`,
            boxShadow:
              "0 0 0 1.5px rgba(255, 255, 255, 0.45), 0 0 0 3px rgba(255, 255, 255, 0.08), 0 0 20px rgba(255, 255, 255, 0.08)",
          }}
        />
      )}
    </>
  );
}
