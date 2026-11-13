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
// A link a person clicks opens in their own browser: Misty shows web pages only to agents.
configureMistyBrowserLinkOpener(async (url) => {
  if (!hasTauriInternals()) throw new Error("Links open only from the desktop app.");
  await openUrl(url);
});
installExternalLinkRouting();
initializeHostAgentsRuntime();
// The theme chosen last time, so a light-theme window doesn't open dark before settings load.
applyCachedAppTheme();
// The interface and code fonts chosen in Settings, and the performance panel's recording when on.
void applySavedFonts();
if (hasTauriInternals()) startPerformanceRecording();
if (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1") {
  void import("@/shared/platform/clientDebug").then(({ installClientDebugging }) => {
    installClientDebugging();
  });
}
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
export const startup = bootstrap();
/**
 * What removed features left behind: marks from when an account's password also derived its vault
 * keys, and each chat's project and coding tool. Nothing reads them now.
 */
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
    // Without storage there is nothing to remove.
  }
}
async function bootstrap() {
  removeRetiredStorage();
  // The app and its styles load while the session is prepared, not after it. The shell
  // loads beside them too, instead of when the first route renders.
  const appModules = Promise.all([import("./App"), import("@/styles/styles.css")]);
  void import("./layouts/DesktopLayout").catch(() => undefined);
  // Every request goes to the server this device chose, so the choice is read first.
  await (await import("@/api/deployment/serverChoice")).loadServerChoice();
  const [{ App }] = await appModules;
  root.render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}
