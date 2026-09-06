import { styleComponentDefinition } from "./componentStyles";
import type { OfficialApp } from "@/api/apps";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { installOfficialDesktopPackage, officialDesktopPackageReady } from "./desktopPackages";
import type { MistyComponentDefinition } from "@misty/sdk";
import { isTrustedHostApp } from "./trustedHostApps";

const modules = new Map<string, Promise<MistyComponentDefinition>>();

export function desktopComponentUrl(app: OfficialApp): URL {
  if (!isTrustedHostApp(app) || app.desktop.runtime !== "downloaded" || !app.desktop.sha256)
    throw new Error("This App does not provide a signed desktop component.");
  const base = navigator.userAgent.includes("Windows")
    ? "http://misty-extension.localhost"
    : "misty-extension://localhost";
  const url = new URL(`/public/${encodeURIComponent(app.id)}/web/app.js`, base);
  url.searchParams.set("version", app.desktop.sha256);
  return url;
}

export async function loadDesktopApp(app: OfficialApp): Promise<MistyComponentDefinition> {
  if (!hasTauriInternals())
    throw new Error("Open this App in Misty desktop to download and run it.");
  const url = desktopComponentUrl(app);
  // Verify the archive signature AND every extracted file before executing code.
  // Identity fields from the catalog alone never establish host trust.
  if (!(await officialDesktopPackageReady(app))) {
    await installOfficialDesktopPackage(app);
    if (!(await officialDesktopPackageReady(app)))
      throw new Error("The downloaded App could not be verified.");
  }
  let pending = modules.get(url.href);
  if (!pending) {
    pending = import(/* @vite-ignore */ url.href).then(
      (module: { default?: MistyComponentDefinition }) => {
        const definition = module.default;
        if (
          !definition ||
          definition.protocol !== 2 ||
          definition.appId !== app.id ||
          typeof definition.mount !== "function" ||
          (definition.createSession !== undefined && typeof definition.createSession !== "function")
        )
          throw new Error(
            "This App package requires a compatible desktop component export. Update it from Discover.",
          );
        const stylesheet = new URL("app.css", url);
        stylesheet.search = url.search;
        return styleComponentDefinition(definition, stylesheet);
      },
    );
    modules.set(url.href, pending);
    pending.catch(() => modules.delete(url.href));
  }
  return pending;
}
