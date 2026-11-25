import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, type ReactNode } from "react";
import { Portal, Surface, ViewHeader, ViewportLayer } from "@misty/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";

function setWindowFullscreen(on: boolean) {
  if (!hasTauriInternals()) return;
  void getCurrentWindow()
    .setFullscreen(on)
    .catch(() => undefined);
}

export function CallFullscreenFrame({
  title,
  onExit,
  children,
}: {
  title: string;
  onExit(): void;
  children: ReactNode;
}) {
  useEffect(() => {
    setWindowFullscreen(true);
    return () => setWindowFullscreen(false);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);
  return (
    <Portal>
      <ViewportLayer layer="workspace-overlay">
        <Surface tone="page" className="flex size-full flex-col">
          <ViewHeader title={title} />
          {children}
        </Surface>
      </ViewportLayer>
    </Portal>
  );
}
