import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { HomeDashboard } from "./HomeDashboard";

export default function HomePage() {
  const { user } = useAuth();
  const { spaces, snapshotReady, loading, load } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      loading: state.loading,
      load: state.load,
    })),
  );

  useEffect(() => {
    if (user && !snapshotReady && !loading) void load();
  }, [load, loading, snapshotReady, user]);

  return (
    <HomeDashboard
      loading={Boolean(user) && loading}
      signedIn={Boolean(user)}
      spaces={user ? spaces : []}
    />
  );
}
