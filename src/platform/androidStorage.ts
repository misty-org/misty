import { isAndroidBuild } from "./buildTarget";

export const androidLocalRoot = "misty://local";

export function explorerRootForBuild(fallbackPath: string): string {
  return isAndroidBuild ? androidLocalRoot : fallbackPath;
}
