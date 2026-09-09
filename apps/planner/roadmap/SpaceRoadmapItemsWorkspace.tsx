import { HostRoadmapRuntimeProvider } from "./spaceRoadmap/HostSpaceRoadmap";
import { SpaceRoadmapItemsView } from "./SpaceRoadmapItemsView";
export function SpaceRoadmapItemsWorkspace(props: Parameters<typeof SpaceRoadmapItemsView>[0]) {
  return (
    <HostRoadmapRuntimeProvider spaceId={props.spaceId}>
      <SpaceRoadmapItemsView {...props} />
    </HostRoadmapRuntimeProvider>
  );
}
