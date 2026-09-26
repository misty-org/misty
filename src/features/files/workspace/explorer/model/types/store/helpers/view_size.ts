import type { ExplorerStore } from "../../../interfaces/store/types";

export type ExplorerStoreSetter = (
  partial:
    | Partial<ExplorerStore>
    | ExplorerStore
    | ((state: ExplorerStore) => Partial<ExplorerStore> | ExplorerStore),
) => void;
