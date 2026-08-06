import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { useAppRouteMemoryStore } from "@/stores/app/useAppRouteMemoryStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import {
  defaultSpaceRoute,
  useSpacesTabsStore,
  type WorkspaceTabKind,
} from "@/stores/spaces/useSpacesTabsStore";

export function LegacyWorkspaceToolRedirect(props: { kind: Exclude<WorkspaceTabKind, "space"> }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const started = useRef(false);
  const spaces = useSpacesStore((state) => state.spaces);
  const snapshotReady = useSpacesStore((state) => state.snapshotReady);
  const load = useSpacesStore((state) => state.load);

  useEffect(() => {
    if (!user?.id || snapshotReady || started.current) return;
    void load({ accountId: user.id });
  }, [load, snapshotReady, user?.id]);

  useEffect(() => {
    if (!user?.id || !snapshotReady || started.current) return;
    started.current = true;
    const rememberedRoute = useAppRouteMemoryStore.getState().lastSpacesRoute;
    const rememberedId = spaceIdFromRoute(rememberedRoute);
    const target = spaces.find((space) => space.id === rememberedId) ?? spaces[0];
    if (!target) {
      navigate("/spaces", { replace: true });
      return;
    }
    const tabs = useSpacesTabsStore.getState();
    const route = rememberedId === target.id ? rememberedRoute : defaultSpaceRoute(target.id);
    tabs.ensureSession(user.id, target.id, route);
    tabs.addTab(user.id, target.id, props.kind);
    navigate(route, { replace: true, state: { mistySpaceSwitch: true } });
  }, [navigate, props.kind, snapshotReady, spaces, user?.id]);

  return null;
}

function spaceIdFromRoute(route: string): string {
  try {
    const parts = new URL(route, "https://misty.local").pathname.split("/").filter(Boolean);
    return parts[0] === "spaces" && parts[1] ? decodeURIComponent(parts[1]) : "";
  } catch {
    return "";
  }
}
