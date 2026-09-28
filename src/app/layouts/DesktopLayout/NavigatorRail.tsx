import type { DockPosition } from "@/features/app-shell/dockingLayout";
import {
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "@/features/webviews/browserRuntime";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable } from "@/shared/ui";
import { dockingGeometry } from "./dockingGeometry";
import { navigatorMotionClass } from "./styles";

/** One fixed-width rail; auto-hide reveals it above the workspace without reflow. */
export function NavigatorRail(props: {
  autoHide: boolean;
  position: DockPosition;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLButtonElement>(null);
  const pointerInside = useRef(false);
  const hide = useRef(() => {});
  const cancelHide = useRef(() => {});
  const geometry = dockingGeometry(props.position, props.autoHide);
  const hidden = props.autoHide && !revealed;

  useEffect(() => {
    if (!props.autoHide) {
      setRevealed(false);
      return;
    }
    pointerInside.current = false;
    setRevealed(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heldOpen = () =>
      pointerInside.current ||
      rail.current?.querySelector(
        ':focus-visible, [aria-haspopup][aria-expanded="true"], [aria-haspopup][data-state="open"]',
      );
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      if (heldOpen()) cancel();
      else if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          if (!heldOpen()) setRevealed(false);
        }, 180);
    };
    hide.current = schedule;
    cancelHide.current = cancel;
    const contains = (element: HTMLElement | null, x: number, y: number) => {
      const bounds = element?.getBoundingClientRect();
      return Boolean(
        bounds && x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom,
      );
    };
    const move = (x: number, y: number) => {
      pointerInside.current = contains(rail.current, x, y);
      if (contains(edge.current, x, y)) {
        cancel();
        setRevealed(true);
      } else schedule();
    };
    const pointer = (event: PointerEvent) => move(event.clientX, event.clientY);
    const nativePointer = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (Number.isFinite(x) && Number.isFinite(y)) move(x, y);
    };
    const mutations = new MutationObserver(schedule);
    if (rail.current)
      mutations.observe(rail.current, {
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-expanded", "data-state"],
      });
    window.addEventListener("pointermove", pointer);
    window.addEventListener("misty:browser-pointer", nativePointer);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    setBrowserPointerTrackingEnabled(true);
    return () => {
      cancel();
      mutations.disconnect();
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("misty:browser-pointer", nativePointer);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      setBrowserPointerTrackingEnabled(false);
      hide.current = () => {};
      cancelHide.current = () => {};
    };
  }, [props.autoHide, props.position]);

  useEffect(() => {
    setBrowserWebviewsSuspended(props.autoHide && revealed, "navigator-reveal");
    return () => setBrowserWebviewsSuspended(false, "navigator-reveal");
  }, [props.autoHide, revealed]);

  return (
    <>
      <div
        ref={rail}
        className={`misty-docking-nav transition-[transform,opacity] ${navigatorMotionClass}`}
        data-floating={props.autoHide}
        style={{
          ...(props.autoHide ? geometry.floating : geometry.navigation),
          transform: hidden ? geometry.translate : undefined,
          opacity: hidden ? 0 : 1,
          pointerEvents: hidden ? "none" : undefined,
        }}
        aria-hidden={hidden}
        inert={hidden ? true : undefined}
        onPointerEnter={(event) => {
          if (!props.autoHide) return;
          if (!event.currentTarget.contains(event.target as Node)) return;
          pointerInside.current = true;
          cancelHide.current();
          setRevealed(true);
        }}
        onPointerLeave={() => {
          pointerInside.current = false;
          hide.current();
        }}
        onKeyDown={(event) => {
          if (
            props.autoHide &&
            event.key === "Escape" &&
            !event.defaultPrevented &&
            !rail.current?.querySelector('[aria-haspopup][aria-expanded="true"]')
          ) {
            event.preventDefault();
            document
              .querySelector<HTMLButtonElement>("[data-navigator-visibility-toggle]")
              ?.focus();
            setRevealed(false);
          }
        }}
      >
        {props.children}
      </div>
      {props.autoHide && (
        <Pressable
          ref={edge}
          type="button"
          aria-label="Show navigation"
          data-navigator-reveal
          className="absolute z-30 border-0 bg-transparent p-0"
          style={{ ...geometry.reveal, pointerEvents: revealed ? "none" : undefined }}
          tabIndex={revealed ? -1 : 0}
          onPointerEnter={() => {
            cancelHide.current();
            setRevealed(true);
          }}
          onFocus={() => {
            setRevealed(true);
            requestAnimationFrame(() =>
              rail.current?.querySelector<HTMLElement>("button:not(:disabled), a[href]")?.focus(),
            );
          }}
        />
      )}
    </>
  );
}
