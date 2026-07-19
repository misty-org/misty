import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const PUBLIC_ASSET_BASE_URL =
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL || "https://public.mistysys.com";

type HeroScreenshot = {
  id: string;
  src: string;
  alt: string;
};

const heroScreenshots: HeroScreenshot[] = [
  {
    id: "pic1",
    src: `${PUBLIC_ASSET_BASE_URL}/showcase/pic1.png`,
    alt: "Misty showcase screenshot 1",
  },
  {
    id: "pic2",
    src: `${PUBLIC_ASSET_BASE_URL}/showcase/pic2.png`,
    alt: "Misty showcase screenshot 2",
  },
  {
    id: "pic3",
    src: `${PUBLIC_ASSET_BASE_URL}/showcase/pic3.png`,
    alt: "Misty showcase screenshot 3",
  },
  {
    id: "pic4",
    src: `${PUBLIC_ASSET_BASE_URL}/showcase/pic4.png`,
    alt: "Misty showcase screenshot 4",
  },
  {
    id: "pic5",
    src: `${PUBLIC_ASSET_BASE_URL}/showcase/pic5.png`,
    alt: "Misty showcase screenshot 5",
  },
  {
    id: "pic6",
    src: `${PUBLIC_ASSET_BASE_URL}/showcase/pic6.png`,
    alt: "Misty showcase screenshot 6",
  },
];

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function wrapIndex(index: number, length: number) {
  return ((index % length) + length) % length;
}

function shortestOffset(index: number, activeIndex: number, length: number) {
  const rawOffset = index - activeIndex;
  const half = length / 2;

  if (rawOffset > half) return rawOffset - length;
  if (rawOffset < -half) return rawOffset + length;

  return rawOffset;
}

function slideTransform(offset: number, dragOffset: number, reducedMotion: boolean) {
  if (reducedMotion) {
    return offset === 0
      ? "translateX(-50%) scale(1)"
      : `translateX(-50%) translateX(${offset * 180}px) scale(0.97)`;
  }

  const sideOffset = "min(30vw, 450px)";
  const depth = Math.min(Math.abs(offset), 3) * -58;
  const rotate = offset * -4;
  const scale = Math.max(0.9, 1 - Math.abs(offset) * 0.035);
  const dragNudge = dragOffset * 0.58;

  return `translateX(-50%) translateX(calc(${offset} * ${sideOffset} + ${dragNudge}px)) translateZ(${depth}px) rotateY(${rotate}deg) scale(${scale})`;
}

function getSlideIndexAtPoint(x: number, y: number) {
  const element = document.elementFromPoint(x, y);
  const slide = element?.closest<HTMLElement>("[data-carousel-index]");
  const index = Number(slide?.dataset.carouselIndex);

  return Number.isInteger(index) ? index : null;
}

export default function FeatureDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef(0);
  const suppressClick = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  const visibleScreenshots = useMemo(
    () => heroScreenshots.filter((screenshot) => !failedIds.has(screenshot.id)),
    [failedIds],
  );
  const visibleCount = visibleScreenshots.length;
  const currentIndex = visibleCount ? wrapIndex(activeIndex, visibleCount) : 0;
  const renderedScreenshots = useMemo(() => {
    if (visibleCount === 2) {
      const previousIndex = wrapIndex(currentIndex - 1, visibleCount);
      const nextIndex = wrapIndex(currentIndex + 1, visibleCount);

      return [
        {
          key: `${visibleScreenshots[previousIndex].id}-previous`,
          screenshot: visibleScreenshots[previousIndex],
          index: previousIndex,
          offset: -1,
        },
        {
          key: `${visibleScreenshots[currentIndex].id}-active`,
          screenshot: visibleScreenshots[currentIndex],
          index: currentIndex,
          offset: 0,
        },
        {
          key: `${visibleScreenshots[nextIndex].id}-next`,
          screenshot: visibleScreenshots[nextIndex],
          index: nextIndex,
          offset: 1,
        },
      ];
    }

    return visibleScreenshots.map((screenshot, index) => ({
      key: screenshot.id,
      screenshot,
      index,
      offset: shortestOffset(index, currentIndex, visibleCount),
    }));
  }, [currentIndex, visibleCount, visibleScreenshots]);
  const shouldPause = hovering || focused || dragging || reducedMotion || visibleCount < 2;

  useEffect(() => {
    if (shouldPause) return;

    const interval = window.setInterval(() => {
      setActiveIndex((index) => wrapIndex(index + 1, visibleCount));
    }, 5000);

    return () => window.clearInterval(interval);
  }, [shouldPause, visibleCount]);

  function markFailed(id: string) {
    setFailedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function moveBy(delta: number) {
    if (visibleCount < 2) return;
    setActiveIndex((index) => wrapIndex(index + delta, visibleCount));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (visibleCount < 2) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartX.current = event.clientX;
    suppressClick.current = false;
    setDragging(true);
    setDragOffset(0);
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;

    const distance = event.clientX - dragStartX.current;
    suppressClick.current = Math.abs(distance) > 8;
    setDragging(false);
    setDragOffset(0);

    if (Math.abs(distance) <= 8) {
      const targetIndex = getSlideIndexAtPoint(event.clientX, event.clientY);
      if (targetIndex !== null && targetIndex !== currentIndex) {
        setActiveIndex(targetIndex);
        suppressClick.current = true;
      }
      return;
    }

    if (Math.abs(distance) < 40) return;
    moveBy(distance < 0 ? 1 : -1);
  }

  if (visibleCount === 0) {
    return null;
  }

  return (
    <div
      className="relative mx-auto w-full max-w-[1500px] overflow-hidden py-2"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      <div
        className="relative mx-auto h-[280px] w-full overflow-hidden [perspective:1900px] sm:h-[400px] md:h-[540px] lg:h-[620px]"
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => {
          if (!dragging) return;

          const distance = event.clientX - dragStartX.current;
          if (Math.abs(distance) > 8) suppressClick.current = true;
          setDragOffset(distance);
        }}
        onPointerCancel={finishDrag}
        onPointerUp={finishDrag}
        style={{ touchAction: "pan-y" }}
      >
        {renderedScreenshots.map(({ key, screenshot, index, offset }) => {
          const distance = Math.abs(offset);
          const isActive = index === currentIndex && offset === 0;
          const hiddenBehindStack = distance > 3;
          const slideWidthClass = isActive
            ? "w-[min(94vw,1180px)] sm:w-[min(90vw,1180px)] md:w-[min(84vw,1180px)] lg:w-[min(78vw,1180px)]"
            : "w-[min(72vw,760px)] sm:w-[min(58vw,760px)] md:w-[min(44vw,720px)] lg:w-[min(36vw,680px)]";

          return (
            <div
              key={key}
              className={`absolute left-1/2 top-3 h-[calc(100%-2.25rem)] select-none overflow-visible bg-transparent [backface-visibility:hidden] ${slideWidthClass} ${
                reducedMotion ? "" : "transition-[opacity,transform,filter,width] duration-700 ease-out"
              }`}
              aria-current={isActive ? "true" : undefined}
              aria-hidden={hiddenBehindStack ? true : undefined}
              aria-label={`Show screenshot ${index + 1}`}
              data-carousel-index={index}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                if (!isActive) setActiveIndex(index);
              }}
              onKeyDown={(event) => {
                if (isActive) return;
                if (event.key !== "Enter" && event.key !== " ") return;

                event.preventDefault();
                setActiveIndex(index);
              }}
              role="button"
              tabIndex={hiddenBehindStack ? -1 : 0}
              style={{
                cursor: visibleCount > 1 ? (dragging ? "grabbing" : isActive ? "grab" : "pointer") : "default",
                filter: isActive ? "brightness(1)" : "brightness(0.84) saturate(0.96)",
                opacity: hiddenBehindStack ? 0 : Math.max(0.44, 1 - distance * 0.12),
                pointerEvents: hiddenBehindStack ? "none" : undefined,
                transform: slideTransform(offset, dragOffset, reducedMotion),
                transformStyle: "preserve-3d",
                transitionDuration: dragging ? "0ms" : undefined,
                zIndex: visibleCount - distance,
              }}
            >
              <img
                src={screenshot.src}
                alt={screenshot.alt}
                className="block h-full w-full select-none object-contain object-center"
                draggable={false}
                onError={() => markFailed(screenshot.id)}
              />
            </div>
          );
        })}
      </div>

      {visibleCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {visibleScreenshots.map((screenshot, index) => (
            <Button
              key={`${screenshot.id}-dot`}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Show screenshot ${index + 1}`}
              aria-pressed={currentIndex === index}
              onClick={() => setActiveIndex(index)}
              className="size-6 rounded-full p-0"
            >
              <span
                aria-hidden="true"
                className={`size-2.5 rounded-full border transition-all duration-300 ${
                  currentIndex === index
                    ? "border-primary bg-primary shadow-sm"
                    : "border-muted-foreground/60 bg-transparent group-hover/button:border-foreground"
                }`}
              />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
