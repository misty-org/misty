// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Whether the `/mcp` panel is open, with the engine and folder it shows. A store of its own, so
 * the composer can open it directly while the panel is mounted elsewhere.
 */
import { create } from "zustand";

interface McpPanelState {
  open: boolean;
  engine: string;
  workspace: string | null;
  openPanel(engine: string, workspace: string | null): void;
  closePanel(): void;
}

export const useMcpPanel = create<McpPanelState>((set) => ({
  open: false,
  engine: "claude",
  workspace: null,
  openPanel: (engine, workspace) => set({ open: true, engine, workspace }),
  closePanel: () => set({ open: false }),
}));
