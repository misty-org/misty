import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { LoadingState } from "@/ui";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { routes } from "./paths";

export function legacyAssistantDestination(
  search: string,
  accessibleSpaceIds?: ReadonlySet<string>,
): string {
  const params = new URLSearchParams(search);
  const spaceId = params.get("spaceId")?.trim() ?? "";
  params.delete("spaceId");

  if (spaceId && accessibleSpaceIds?.has(spaceId)) {
    // File-system paths belong to the private Files assistant and must not be
    // carried into a collaborative Space URL.
    params.delete("path");
    params.delete("paths");
    params.delete("mika");
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return `${routes.spaces}/${encodeURIComponent(spaceId)}/assistant${suffix}`;
  }

  params.set("mika", "open");
  return `${routes.files}?${params.toString()}`;
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
        title="Opening Mika"
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
