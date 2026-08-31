import { deploymentStorageKey } from "@/api/deployment/api";
import { useEffect } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { useAuth } from "@/features/auth";
import { useSpacesStore } from "./store/useSpacesStore";

import { SpaceSectionView } from "./SpaceSectionView";
import { canonicalSpaceRoute } from "./spaceRouteNormalization";

export { default, SpacesIndexRedirect } from "./components/SpacesShell";

export function SpaceDetail() {
  const { spaceId = "", section = "home", studioKind = "" } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const currentRoute = `${location.pathname}${location.search}${location.hash}`;
  const canonicalRoute = canonicalSpaceRoute(currentRoute);
  const { spaces, loadSpace } = useSpacesStore(
    useShallow((state) => ({ spaces: state.spaces, loadSpace: state.loadSpace })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId && user) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user]);
  useEffect(() => {
    if (!space || !user?.id) return;
    try {
      window.localStorage.setItem(
        deploymentStorageKey(`misty:last-active-space:${user.id}`),
        space.id,
      );
    } catch {
      /* local route memory can be unavailable in private contexts */
    }
  }, [space, user?.id]);

  if (canonicalRoute !== currentRoute) return <Navigate to={canonicalRoute} replace />;

  // Route normalisation is this component's whole job now. The section itself
  // renders from props so the dock can show it in more than one pane, which a
  // single router outlet cannot do.
  return <SpaceSectionView spaceId={spaceId} section={section} studioKind={studioKind} />;
}
