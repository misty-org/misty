import type { ProvidersStore } from "../interfaces/useProvidersStore";

export type ProvidersSet = (
  partial: Partial<ProvidersStore> | ((state: ProvidersStore) => Partial<ProvidersStore>),
) => void;
