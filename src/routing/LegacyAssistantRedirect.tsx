import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { LoadingState } from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { routes } from "./paths";

export function legacyAssistantDestination(
  search: string,
  _accessibleSpaceIds?: ReadonlySet<string>,
): string {
  const params = new URLSearchParams(search);
  params.delete("mika");
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return `${routes.agents}${suffix}`;
}

export function LegacyAssistantRedirect() {
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
      to={legacyAssistantDestination(
        location.search,
        accessVerified ? new Set(spaces.map((space) => space.id)) : new Set(),
      )}
      replace
    />
  );
}
