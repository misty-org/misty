import { useMemo } from "react";
import { runtimeAssetSource } from "@/platform/runtimeAsset";
import { useAppStore } from "@/stores/app";

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
