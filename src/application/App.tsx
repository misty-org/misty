import { AppRouter } from "./router";
import { DesktopWindowReady } from "./layouts/DesktopWindowReady";
import { useLayoutEffect } from "react";
import { installOverflowFade } from "@/shared/ui/overflow-fade";

export function App() {
  useLayoutEffect(() => installOverflowFade(), []);
  return (
    <>
      <DesktopWindowReady />
      <AppRouter />
    </>
  );
}
