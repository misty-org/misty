import { create } from "zustand";
import { formatDeviceCode } from "./device_code";

interface DeviceApprovalState {
  open: boolean;
  code: string;
  request: number;
}

export const useDeviceApprovalStore = create<DeviceApprovalState>(() => ({
  open: false,
  code: "",
  request: 0,
}));

export function openDeviceApproval(code = ""): void {
  useDeviceApprovalStore.setState((state) => ({
    open: true,
    code: formatDeviceCode(code),
    request: state.request + 1,
  }));
}

export function closeDeviceApproval(): void {
  useDeviceApprovalStore.setState({ open: false });
}
