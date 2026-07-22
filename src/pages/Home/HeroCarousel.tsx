import { useEffect, useMemo, useRef, useState } from "react";

type HeroScreen = {
  id: string;
  src: string;
  alt: string;
};

const heroScreens: HeroScreen[] = [
  {
    id: "library",
    src: "/space-library-crop.webp",
    alt: "Misty Space Library with shared project research and files",
  },
  { id: "browse", src: "/misty-browse.png", alt: "Browsing files across local and connected storage" },
  { id: "search", src: "/misty-search.png", alt: "Unified search across a Space" },
  { id: "connect", src: "/misty-connect.png", alt: "Connecting the tools a project already uses" },
  { id: "mika", src: "/mika.webp", alt: "An agent answering with the Space in view" },
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
      : `translateX(-50%) translateX(${offset * 170}px) scale(0.95)`;
  }

  const sideOffset = "min(26vw, 380px)";
  const depth = Math.min(Math.abs(offset), 3) * -60;
  const rotate = offset * -5;
  const scale = Math.max(0.88, 1 - Math.abs(offset) * 0.04);
  const dragNudge = dragOffset * 0.55;

  return `translateX(-50%) translateX(calc(${offset} * ${sideOffset} + ${dragNudge}px)) translateZ(${depth}px) rotateY(${rotate}deg) scale(${scale})`;
}

export default function HeroCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef(0);
  const suppressClick = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  const visibleScreens = useMemo(
    () => heroScreens.filter((screen) => !failedIds.has(screen.id)),
    [failedIds],
  );
  const visibleCount = visibleScreens.length;
  const currentIndex = visibleCount ? wrapIndex(activeIndex, visibleCount) : 0;
  const shouldPause = hovering || dragging || reducedMotion || visibleCount < 2;

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

    if (Math.abs(distance) < 40) return;
    moveBy(distance < 0 ? 1 : -1);
  }

  if (visibleCount === 0) {
    return null;
  }

  return (
    <div
      className="relative mx-auto w-full max-w-[1400px]"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        className="relative mx-auto h-[240px] w-full overflow-hidden [perspective:1900px] sm:h-[360px] md:h-[460px] lg:h-[520px]"
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
        {visibleScreens.map((screen, index) => {
          const offset = shortestOffset(index, currentIndex, visibleCount);
          const distance = Math.abs(offset);
          const isActive = offset === 0;
          const hidden = distance > 2;
          const slideWidthClass = isActive
            ? "w-[min(92vw,1040px)] md:w-[min(80vw,1040px)] lg:w-[min(72vw,1040px)]"
            : "w-[min(70vw,720px)] md:w-[min(46vw,660px)] lg:w-[min(38vw,620px)]";

          return (
            <div
              key={screen.id}
              className={`absolute left-1/2 top-2 h-[calc(100%-1rem)] select-none [backface-visibility:hidden] ${slideWidthClass} ${
                reducedMotion ? "" : "transition-[opacity,transform,width] duration-700 ease-out"
              }`}
              aria-current={isActive ? "true" : undefined}
              aria-hidden={hidden ? true : undefined}
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
              tabIndex={hidden ? -1 : 0}
              aria-label={`Show ${screen.alt}`}
              style={{
                cursor: dragging ? "grabbing" : isActive ? "grab" : "pointer",
                opacity: hidden ? 0 : Math.max(0.5, 1 - distance * 0.25),
                pointerEvents: hidden ? "none" : undefined,
                transform: slideTransform(offset, dragOffset, reducedMotion),
                transformStyle: "preserve-3d",
                transitionDuration: dragging ? "0ms" : undefined,
                zIndex: visibleCount - distance,
              }}
            >
              <div className="h-full overflow-hidden rounded-2xl border border-showcase-foreground/15 bg-showcase p-1.5 shadow-2xl shadow-black/40 sm:p-2">
                <img
                  src={screen.src}
                  alt={screen.alt}
                  className="block h-full w-full select-none rounded-xl object-cover object-top"
                  draggable={false}
                  loading={index === 0 ? "eager" : "lazy"}
                  onError={() => markFailed(screen.id)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {visibleCount > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          {visibleScreens.map((screen, index) => (
            <button
              key={`${screen.id}-dot`}
              type="button"
              aria-label={`Show ${screen.alt}`}
              aria-pressed={currentIndex === index}
              onClick={() => setActiveIndex(index)}
              className={`h-2 w-2 rounded-full transition-all duration-300 ${
                currentIndex === index
                  ? "w-5 bg-showcase-foreground"
                  : "bg-showcase-foreground/35 hover:bg-showcase-foreground/60"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
