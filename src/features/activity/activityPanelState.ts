import { create } from "zustand";

export const useActivityPanel = create<{
  open: boolean;
  approvalId?: string;
  interventionId?: string;
}>(() => ({ open: false }));

export function openActivityPanel(href = "/activity") {
  const params = new URL(href, "https://misty.invalid").searchParams;
  useActivityPanel.setState({
    open: true,
    approvalId: params.get("approval") || undefined,
    interventionId: params.get("intervention") || undefined,
  });
}

export function closeActivityPanel() {
  useActivityPanel.setState({ open: false, approvalId: undefined, interventionId: undefined });
}
