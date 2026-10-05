import { create } from "zustand";

export const useActivityPanel = create<{
  open: boolean;
  interventionId?: string;
}>(() => ({ open: false }));

export function openActivityPanel(href = "/activity") {
  const params = new URL(href, "https://misty.invalid").searchParams;
  useActivityPanel.setState({
    open: true,
    interventionId: params.get("intervention") || undefined,
  });
}

export function closeActivityPanel() {
  useActivityPanel.setState({ open: false, interventionId: undefined });
}
