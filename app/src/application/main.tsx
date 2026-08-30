import { useAppStore } from "@/features/app-shell";
import { analytics } from "@/telemetry/client";
import { initializeAnalyticsLifecycle } from "@/telemetry/lifecycle";
import { TelemetryErrorBoundary } from "@/telemetry/TelemetryErrorBoundary";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { configureProviderAuthorizationLinkOpener } from "@/shared/platform/openExternalLink";
import { configureAssetIconEnvironment } from "@/shared/ui/asset-icon";
import ReactDOM from "react-dom/client";
import { mistyDesktopSurface } from "@/features/desktop-pet/desktopPet";

configureAssetIconEnvironment({
  subscribe: useAppStore.subscribe,
  getSnapshot: () => useAppStore.getState().app?.environment.assetsDir,
});

configureProviderAuthorizationLinkOpener(async (url) => {
  const { useWorkspaceStore } = await import("@/features/workspace");
  useWorkspaceStore.getState().openBrowserTab({ url });
});

if (
  import.meta.env.MODE !== "mobile" &&
  !isNativeMobileBuild &&
  (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1")
) {
  void import("@/shared/platform/clientDebug").then(({ installClientDebugging }) => {
    installClientDebugging();
  });
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

void bootstrap();

async function bootstrap() {
  const desktopSurface = mistyDesktopSurface();
  if (desktopSurface === "pet") {
    const { bootstrapDemoSession } = await import("@/features/auth");
    await bootstrapDemoSession();
    const [{ MistyDesktopSurfaceRoot }] = await Promise.all([
      import("@/features/desktop-pet"),
      import("@/styles/styles.css"),
    ]);
    root.render(
      <TelemetryErrorBoundary>
        <MistyDesktopSurfaceRoot surface="pet" />
      </TelemetryErrorBoundary>,
    );
    return;
  }
  const { bootstrapDemoSession } = await import("@/features/auth");
  await bootstrapDemoSession();
  void analytics.initialize().then(initializeAnalyticsLifecycle);
  const [{ App }] = await Promise.all([import("./App"), import("@/styles/styles.css")]);
  root.render(
    <TelemetryErrorBoundary>
      <App />
    </TelemetryErrorBoundary>,
  );
}
