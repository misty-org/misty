import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import {
  configureMistyBrowserLinkOpener,
  installExternalLinkRouting,
} from "@/shared/platform/openExternalLink";
import { hasTauriInternals } from "@/shared/platform/tauri";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./AppErrorBoundary";
configureMistyBrowserLinkOpener(async (url) => {
  if (!hasTauriInternals())
    throw new Error("Misty Browser is unavailable outside the desktop app.");
  const { useWorkspaceStore } = await import("@/features/workspace");
  if (
    !useWorkspaceStore.getState().openBrowserView({
      url,
    })
  )
    throw new Error("Misty Browser could not open this link.");
});
installExternalLinkRouting();
initializeHostAgentsRuntime();
if (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1") {
  void import("@/shared/platform/clientDebug").then(({ installClientDebugging }) => {
    installClientDebugging();
  });
}
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
export const startup = bootstrap();
async function bootstrap() {
  // The app and its styles load while the session is prepared, not after it. The shell
  // loads beside them too, instead of when the first route renders.
  const appModules = Promise.all([import("./App"), import("@/styles/styles.css")]);
  void import("./layouts/DesktopLayout").catch(() => undefined);
  // Every request goes to the server this device chose, so the choice is read first.
  await (await import("@/api/deployment/serverChoice")).loadServerChoice();
  const { bootstrapDemoSession } = await import("@/features/auth");
  await bootstrapDemoSession();
  const [{ App }] = await appModules;
  root.render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}
