import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { useSpacesStore } from "../stores/useSpacesStore";

export function SpacesRealtimeBridge() {
  const { user } = useAuth();
  const load = useSpacesStore((state) => state.load);
  const loadInbox = useSpacesStore((state) => state.loadInbox);
  const connectRealtime = useSpacesStore((state) => state.connectRealtime);
  const disconnectRealtime = useSpacesStore((state) => state.disconnectRealtime);

  useEffect(() => {
    if (!user) { disconnectRealtime(); return; }
    void connectRealtime(user.id);
    void Promise.all([load(), loadInbox()]);
    return disconnectRealtime;
  }, [connectRealtime, disconnectRealtime, load, loadInbox, user?.id]);

  return null;
}
