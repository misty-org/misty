import type { WorkspaceTab } from "@/features/workspace/model";
import type { NativeSurfaceId } from "./nativeSurfacePolicy";

/** Legacy routes cannot resurrect a bundled app runtime. */
export default function NativeAppSurface(props: {
  surface: NativeSurfaceId;
  tab: WorkspaceTab;
  active?: boolean;
}) {
  return (
    <div role="alert" className="p-4 text-sm text-cream-muted">
      Open Discover to install or update {props.tab.title} to its downloadable app package.
    </div>
  );
}
