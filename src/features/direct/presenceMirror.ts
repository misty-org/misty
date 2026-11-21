import { useAccountPresence, type AccountPresence } from "@/shared/lib/accountPresence";
import { useStatusStore } from "./statusStore";

/** Keeps the shared account presence (`shared/lib/accountPresence`) in step with the status store. */
function mirror(byUser: ReturnType<typeof useStatusStore.getState>["byUser"]) {
  const next: Record<string, AccountPresence> = {};
  for (const [userId, status] of Object.entries(byUser)) next[userId] = status.status;
  useAccountPresence.setState({ byUser: next });
}

mirror(useStatusStore.getState().byUser);
useStatusStore.subscribe((state, previous) => {
  if (state.byUser !== previous.byUser) mirror(state.byUser);
});
