import { AppRouter } from "./router";
import { NativeWindowSetup } from "./layouts/NativeWindowSetup";
import { NoticeViewport, TooltipProvider } from "@misty/ui";
import { McpProbeConfirmHost } from "@/features/engine-config/mcp";
import { settingsBoolean, useSettingsStore } from "@/features/settings";

export function App() {
  // Settings › Shortcuts › Show shortcut hints, a device setting that is on until turned off.
  const shortcutHints = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "shortcuts", "shortcut_hints_enabled", true),
  );
  return (
    <TooltipProvider shortcutHints={shortcutHints}>
      <NativeWindowSetup />
      <AppRouter />
      <McpProbeConfirmHost />
      <NoticeViewport />
    </TooltipProvider>
  );
}
