import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import type { ContinueItem } from "./useContinueItems";
import { readyHomePreview } from "./useHomePreviewItems";

/** Preserve the source viewport and let the browser rasterize text at display resolution. */
function ScaledPage({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setScale(element.clientWidth / width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={host} className="absolute inset-0 overflow-hidden" aria-hidden inert>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

export function HomePagePreview({ item }: { item: ContinueItem }) {
  const preview = useBrowserRuntimeStore((state) => state.previews[item.tab.id]);
  const current = readyHomePreview(item.tab, preview);
  if (current?.document) {
    return (
      <ScaledPage width={current.document.width} height={current.document.height}>
        <iframe
          title={`Preview of ${item.tab.title || item.detail}`}
          srcDoc={current.document.html}
          sandbox=""
          tabIndex={-1}
          referrerPolicy="no-referrer"
          className="block size-full border-0"
        />
      </ScaledPage>
    );
  }
  if (current?.dataUrl) {
    return (
      <img
        src={current.dataUrl}
        alt=""
        className="absolute inset-0 size-full object-cover object-top"
        onError={() => {
          // A broken image is no longer a usable card. Let the carousel select the next one.
          useBrowserRuntimeStore.setState((state) => {
            if (state.previews[item.tab.id]?.dataUrl !== current.dataUrl) return state;
            return {
              previews: {
                ...state.previews,
                [item.tab.id]: { ...state.previews[item.tab.id], dataUrl: undefined },
              },
            };
          });
        }}
      />
    );
  }
  return null;
}
