import { create } from "zustand";
import { invoke } from "@/native/invoke";

export interface NvimMapping {
  /** `n`, `x` (visual), `o` (operator-pending) or `i`. */
  mode: "n" | "x" | "o" | "i";
  lhs: string;
  rhs: string;
  noremap: boolean;
}

export interface NvimOptions {
  tabstop?: number;
  shiftwidth?: number;
  expandtab?: boolean;
  wrap?: boolean;
  number?: boolean;
  relativenumber?: boolean;
  ignorecase?: boolean;
  smartcase?: boolean;
}

/** What `code_nvim_config` reads from the person's Neovim config (`code/nvim.rs`). */
export interface NvimConfig {
  source: "nvim" | "files" | "none";
  folder: string;
  leader: string;
  mappings: NvimMapping[];
  options: NvimOptions;
  skipped: number;
}

/**
 * The person's Neovim config, read once per window the first time vim mode wants it, and again
 * when they press Read again in Settings. A failed read leaves vim mode on its defaults.
 */
export const useNvimConfig = create<{
  config: NvimConfig | null;
  reading: boolean;
  error: string | null;
  read(force?: boolean): Promise<void>;
}>((set, get) => ({
  config: null,
  reading: false,
  error: null,
  async read(force = false) {
    if (get().reading || (get().config && !force)) return;
    set({ reading: true, error: null });
    try {
      const config = await invoke<NvimConfig>("code_nvim_config");
      set({ config, reading: false });
    } catch (error) {
      set({
        reading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
