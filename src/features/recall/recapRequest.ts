import { create } from "zustand";

/** A recap someone asked to read from outside the memory tree, such as the morning brief's notice. */
export const useRecapRequest = create<{ day: string | null }>(() => ({ day: null }));
