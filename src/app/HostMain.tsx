import "./featureSeams";
import "./settingsEffects";
import "./SettingsSections";
import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import { applySavedFonts } from "@/features/engine-config/fonts";
import { startPerformanceRecording } from "@/features/engine-config/performance";
import {
  configureMistyBrowserLinkOpener,
  installExternalLinkRouting,
} from "@/shared/platform/openExternalLink";
import { hasTauriInternals } from "@/shared/platform/tauri";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { openUrl } from "@tauri-apps/plugin-opener";
import { applyCachedAppTheme } from "@/features/settings";
import { installUiStorage } from "@/shared/lib/uiStorage";
import { followRegistry } from "@/native/registry";
configureMistyBrowserLinkOpener(async (url) => {
  if (!hasTauriInternals()) throw new Error("Links open only from the desktop app.");
  await openUrl(url);
});
installExternalLinkRouting();
initializeHostAgentsRuntime();
applyCachedAppTheme();
installUiStorage();
void applySavedFonts();
followRegistry();
if (hasTauriInternals()) startPerformanceRecording();
if (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1") {
  void import("@/shared/platform/clientDebug").then(({ installClientDebugging }) => {
    installClientDebugging();
  });
}
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
export const startup = bootstrap();
function removeRetiredStorage() {
  try {
    for (const key of [
      "misty-credential-accounts",
      "misty-password-pending",
      "misty.conversationProjects.v1",
      "misty.conversationCodingTools.v1",
    ])
      localStorage.removeItem(key);
  } catch {
  }
}
async function bootstrap() {
  removeRetiredStorage();
  const appModules = Promise.all([import("./App"), import("@/styles/styles.css")]);
  void import("./layouts/DesktopLayout").catch(() => undefined);
  await (await import("@/api/deployment/serverChoice")).loadServerChoice();
  const [{ App }] = await appModules;
  root.render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}
