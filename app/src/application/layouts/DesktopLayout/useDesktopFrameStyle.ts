import { useAppStore } from "@/features/app-shell";
import { runtimeAssetSource } from "@/shared/platform/runtimeAsset";
import { useMemo } from "react";

/**
 * The desktop frame now has one fixed, opaque visual system. The hook only
 * resolves runtime assets; colors and surfaces live in Tailwind classes.
 */
export function useDesktopFrameStyle() {
  const app = useAppStore((state) => state.app);
  const mistyLogoSource = useMemo(
    () => runtimeAssetSource(app?.environment.assetsDir, "logos/misty-white.png"),
    [app?.environment.assetsDir],
  );

  return { app, mistyLogoSource };
}
