import type { useSmartLibraryStore } from "@/features/spaces/library";

export type SmartLibrary = NonNullable<ReturnType<typeof useSmartLibraryStore.getState>["library"]>;

export type SmartLibraryEstimate = ReturnType<typeof useSmartLibraryStore.getState>["estimate"];

export type SmartLibraryProgress = ReturnType<typeof useSmartLibraryStore.getState>["progress"];
