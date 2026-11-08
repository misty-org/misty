import { useAppStore } from "@/app/shell";

export function useDesktopFrameStyle() {
  const app = useAppStore((state) => state.app);
  return { app };
}
