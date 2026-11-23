import { AppRouter } from "./Router";
import { NativeWindowSetup } from "./layouts/NativeWindowSetup";
import { NoticeViewport, TooltipProvider } from "@misty/ui";
import { McpProbeConfirmHost } from "@/features/engine-config/mcp";
import { ConfirmActionHost } from "./ConfirmActionHost";
import { settingsBoolean, useSettingsStore } from "@/features/settings";

export function App() {
  const shortcutHints = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "shortcuts", "shortcut_hints_enabled", true),
  );
  return (
    <TooltipProvider shortcutHints={shortcutHints}>
      <NativeWindowSetup />
      <AppRouter />
      <McpProbeConfirmHost />
      <ConfirmActionHost />
      <NoticeViewport />
    </TooltipProvider>
  );
}
