import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type RefObject } from "react";

export function useNativeMaximizeButton(
  button: RefObject<HTMLElement | null>,
  enabled: boolean,
  onClick: () => void,
): boolean {
  const [hovering, setHovering] = useState(false);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  });

  useEffect(() => {
    if (!enabled || !hasTauriInternals() || !/win/i.test(navigator.platform)) return;
    let last = "";
    let frame = 0;
    const send = () => {
      frame = 0;
      const element = button.current;
      const box = element?.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const rect =
        box && box.width > 0 && box.height > 0
          ? {
              x: Math.round(box.left * scale),
              y: Math.round(box.top * scale),
              width: Math.round(box.width * scale),
              height: Math.round(box.height * scale),
            }
          : null;
      const key = JSON.stringify(rect);
      if (key === last) return;
      last = key;
      void invoke("window_set_maximize_button", { rect }).catch(() => undefined);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(send);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (button.current) observer.observe(button.current);
    observer.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", schedule, true);
    const timer = window.setInterval(schedule, 1000);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", schedule, true);
      window.clearInterval(timer);
      if (frame) window.cancelAnimationFrame(frame);
      void invoke("window_set_maximize_button", { rect: null }).catch(() => undefined);
    };
  }, [button, enabled]);

  useEffect(() => {
    if (!enabled || !hasTauriInternals()) return;
    const hover = listen<boolean>("misty://maximize-button-hover", (event) =>
      setHovering(event.payload === true),
    );
    const click = listen("misty://maximize-button-click", () => onClickRef.current());
    return () => {
      void hover.then((stop) => stop());
      void click.then((stop) => stop());
      setHovering(false);
    };
  }, [enabled]);

  return hovering;
}
