export { preferredDefaultSpace, spaceNavigationName } from "./defaultSpace";
import { useSpacesStore as spacesStore } from "./store/useSpacesStore";

// Keep this as an owned public binding instead of a transitive re-export.
// The store is shared by lazy route chunks; Rollup otherwise creates a
// circular chunk edge between the shell and those routes.
export const useSpacesStore = spacesStore;
export type { Space } from "@/api/spaces/dto/interfaces/types";
