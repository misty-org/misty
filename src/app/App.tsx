import { AppRouter } from "./router";
import { DesktopWindowReady } from "./layouts/DesktopWindowReady";
import { useLayoutEffect } from "react";
import { installOverflowFade } from "@/shared/ui";
import { McpProbeConfirmHost } from "@/features/engine-config/mcp";

export function App() {
  useLayoutEffect(() => installOverflowFade(), []);
  return (
    <>
      <DesktopWindowReady />
      <AppRouter />
      <McpProbeConfirmHost />
    </>
  );
}
