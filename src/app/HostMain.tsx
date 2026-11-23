import "./feature_seams";
import "./settings_effects";
import "./settings_sections";
import { initializeHostAgentsRuntime } from "@/features/agents/host_agents_runtime";
import { applySavedFonts } from "@/features/engine-config/fonts";
import { startPerformanceRecording } from "@/features/engine-config/performance";
import {
  configureMistyBrowserLinkOpener,
  installExternalLinkRouting,
} from "@/shared/platform/open_external_link";
import { hasTauriInternals } from "@/shared/platform/tauri";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { openUrl } from "@tauri-apps/plugin-opener";
import { applyCachedAppTheme } from "@/features/settings";
import { installUiStorage } from "@/shared/lib/ui_storage";
import { followRegistry } from "@/native/registry";
import { loadServerChoice } from "@/api/deployment/server_choice";
configureMistyBrowserLinkOpener(async (url) => {
  if (!hasTauriInternals()) throw new Error("Links open only from the desktop app.");
  await openUrl(url);
});
installExternalLinkRouting();
initializeHostAgentsRuntime();
applyCachedAppTheme();
installUiStorage();
void applySavedFonts();
const registryReady = followRegistry();
if (hasTauriInternals()) startPerformanceRecording();
if (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1") {
  void import("@/shared/platform/client_debug").then(({ installClientDebugging }) => {
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
  } catch {}
}
async function bootstrap() {
  removeRetiredStorage();
  const appModules = Promise.all([import("./App"), import("@/styles/styles.css")]);
  void import("./layouts/DesktopLayout").catch(() => undefined);
  await Promise.all([loadServerChoice(), registryReady]);
  const [{ App }] = await appModules;
  root.render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}
