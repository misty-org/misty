import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { LoadingState } from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { routes } from "./paths";

export function legacyAgentDestination(
  search: string,
  accessibleSpaceIds?: ReadonlySet<string>,
): string {
  const params = new URLSearchParams(search);
  const requestedSpaceId = params.get("spaceId")?.trim() ?? "";
  params.delete("spaceId");
  params.delete("mika");
  params.set("agentDock", "1");
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  if (requestedSpaceId && accessibleSpaceIds?.has(requestedSpaceId)) {
    return `${routes.spaces}/${encodeURIComponent(requestedSpaceId)}/chat${suffix}`;
  }
  return routes.spaces;
}

export function LegacyAgentRedirect() {
  const location = useLocation();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const load = useSpacesStore((state) => state.load);
  const [checkedAccess, setCheckedAccess] = useState(!user);
  const [accessVerified, setAccessVerified] = useState(false);

  useEffect(() => {
    if (!user) {
      setAccessVerified(false);
      setCheckedAccess(true);
      return;
    }
    let current = true;
    setCheckedAccess(false);
    setAccessVerified(false);
    void load().then(() => {
      if (!current) return;
      setAccessVerified(useSpacesStore.getState().snapshotReady);
      setCheckedAccess(true);
    });
    return () => {
      current = false;
    };
  }, [load, user]);

  if (!checkedAccess) {
    return (
      <LoadingState
        className="h-full"
        title="Opening Agents"
        description="Checking your Space access…"
      />
    );
  }

  return (
    <Navigate
      to={legacyAgentDestination(
        location.search,
        accessVerified ? new Set(spaces.map((space) => space.id)) : new Set(),
      )}
      replace
    />
  );
}
