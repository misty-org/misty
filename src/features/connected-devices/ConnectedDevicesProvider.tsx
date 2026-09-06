import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { useConnectedDevices as useConnectedDevicesController } from "./useConnectedDevices";
type ConnectedDevicesController = ReturnType<typeof useConnectedDevicesController>;
const ConnectedDevicesContext = createContext<ConnectedDevicesController | null>(null);
/** The account's devices, for every surface that shows or uses them. */
export function ConnectedDevicesProvider({ children }: PropsWithChildren) {
  const controller = useConnectedDevicesController();
  const value = useMemo(() => controller, [controller]);
  return (
    <ConnectedDevicesContext.Provider value={value}>{children}</ConnectedDevicesContext.Provider>
  );
}
/** The devices controller, or null outside the provider (tests, web). */
export function useOptionalConnectedDevices(): ConnectedDevicesController | null {
  return useContext(ConnectedDevicesContext);
}
export function useConnectedDevices(): ConnectedDevicesController {
  const value = useContext(ConnectedDevicesContext);
  if (!value) throw new Error("useConnectedDevices must be used inside ConnectedDevicesProvider.");
  return value;
}
